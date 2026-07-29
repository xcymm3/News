import {
  generateAndPublishWebSearchDigest,
  WebSearchDigestAgentError,
} from "@/features/agent/web-search-digest-agent";
import { formatShanghaiDate } from "@/features/digest/digest-service";
import {
  DigestPersistenceError,
  prismaDigestRepository,
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

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "定时 Agent 运行失败。";
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return noStoreJson(
      {
        error: {
          code: "UNAUTHORIZED_CRON_REQUEST",
          message: "未授权的定时任务请求。",
        },
      },
      401,
    );
  }

  const digestDate = formatShanghaiDate(new Date());

  try {
    const rollout = getWebSearchRollout();
    if (!canRunWebSearch(rollout)) {
      return noStoreJson({
        data: {
          skipped: true,
        },
        meta: {
          rollout,
          reason: getWebSearchRolloutMessage(rollout),
        },
      });
    }

    const existingDigest = await prismaDigestRepository.findPublishedByDate(digestDate);
    if (existingDigest) {
      return noStoreJson({
        data: {
          digest: existingDigest,
          skipped: true,
        },
        meta: {
          reason: "当前上海日期已有已发布日报。",
        },
      });
    }

    const result = await generateAndPublishWebSearchDigest(digestDate, "cron");

    return noStoreJson({
      data: {
        digest: result.digest,
        skipped: false,
      },
      meta: {
        model: result.model,
        searchProvider: result.searchProvider,
        rollout,
        retrievedDocumentCount: result.retrievedDocumentCount,
      },
    });
  } catch (error) {
    if (error instanceof WebSearchRolloutError) {
      return noStoreJson(
        {
          error: {
            code: "WEB_SEARCH_ROLLOUT_INVALID",
            message: error.message,
          },
        },
        503,
      );
    }

    const message = getErrorMessage(error);

    try {
      await recordFailedAgentRun({
        trigger: "cron",
        digestDate,
        errorMessage: message,
      });
    } catch (recordError) {
      console.error("Failed to record a scheduled Agent error.", recordError);
    }

    console.error("Failed to generate the scheduled news digest.", error);

    return noStoreJson(
      {
        error: {
          code: error instanceof WebSearchDigestAgentError
            ? error.code
            : error instanceof DigestPersistenceError
              ? "DIGEST_PERSISTENCE_FAILED"
              : "AI_AGENT_UNAVAILABLE",
          message: error instanceof WebSearchDigestAgentError || error instanceof DigestPersistenceError
            ? error.message
            : "定时 Agent 暂时不可用，请稍后重试。",
        },
      },
      error instanceof WebSearchDigestAgentError ? error.status : error instanceof DigestPersistenceError ? 503 : 502,
    );
  }
}
