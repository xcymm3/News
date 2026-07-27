import { NewsAgentError, runAgentDigest } from "@/features/agent/news-rag-agent";
import { formatShanghaiDate } from "@/features/digest/digest-service";
import { DigestPersistenceError, publishDigest } from "@/features/digest/prisma-digest-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runAgentDigest(formatShanghaiDate(new Date()));
    const digest = await publishDigest(result.digest, {
      trigger: "manual",
      model: result.provider,
      retrievedDocumentCount: result.retrievedDocumentCount,
    });

    return Response.json(
      {
        data: {
          digest,
        },
        meta: {
          provider: result.provider,
          retrievedDocumentCount: result.retrievedDocumentCount,
          cacheStatus: result.cacheStatus,
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

    if (error instanceof NewsAgentError) {
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

    console.error("Failed to run the news RAG agent.", error);

    return Response.json(
      {
        error: {
          code: "AI_AGENT_UNAVAILABLE",
          message: "AI Agent 暂时不可用，请稍后重试。",
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
