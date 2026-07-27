import {
  generateAndPublishWebSearchDigest,
  WebSearchDigestAgentError,
} from "@/features/agent/web-search-digest-agent";
import { formatShanghaiDate } from "@/features/digest/digest-service";
import {
  DigestPersistenceError,
  recordFailedAgentRun,
} from "@/features/digest/prisma-digest-repository";
import {
  canRunWebSearch,
  getWebSearchRollout,
  getWebSearchRolloutMessage,
  WebSearchRolloutError,
} from "@/features/web-search/web-search-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 270;

export async function POST() {
  const digestDate = formatShanghaiDate(new Date());

  try {
    const rollout = getWebSearchRollout();
    if (!canRunWebSearch(rollout, "manual")) {
      return Response.json(
        {
          error: {
            code: "WEB_SEARCH_ROLLOUT_DISABLED",
            message: getWebSearchRolloutMessage(rollout, "manual"),
          },
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const result = await generateAndPublishWebSearchDigest(digestDate, "manual");

    return Response.json(
      {
        data: {
          digest: result.digest,
        },
        meta: {
          model: result.model,
          searchProvider: result.searchProvider,
          rollout,
          retrievedDocumentCount: result.retrievedDocumentCount,
          generationMode: "agent",
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof WebSearchRolloutError) {
      return Response.json(
        {
          error: {
            code: "WEB_SEARCH_ROLLOUT_INVALID",
            message: error.message,
          },
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const message = error instanceof Error ? error.message : "全网研究 Agent 运行失败。";

    try {
      await recordFailedAgentRun({
        trigger: "manual",
        digestDate,
        errorMessage: message,
      });
    } catch (recordError) {
      console.error("Failed to record a manual Agent error.", recordError);
    }

    if (error instanceof DigestPersistenceError) {
      return Response.json(
        {
          error: {
            code: "DIGEST_PERSISTENCE_FAILED",
            message: error.message,
          },
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (error instanceof WebSearchDigestAgentError) {
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        {
          status: error.status,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    console.error("Failed to run the LangChain web research agent.", error);

    return Response.json(
      {
        error: {
          code: "WEB_RESEARCH_UNAVAILABLE",
          message: "全网研究 Agent 暂时不可用，请稍后重试。",
        },
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
