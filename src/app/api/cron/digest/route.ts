import { NewsAgentError, runAgentDigest } from "@/features/agent/news-rag-agent";
import { formatShanghaiDate } from "@/features/digest/digest-service";
import {
  prismaDigestRepository,
  publishDigest,
  recordFailedAgentRun,
} from "@/features/digest/prisma-digest-repository";

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

    const result = await runAgentDigest(digestDate);
    const digest = await publishDigest(result.digest, {
      trigger: "cron",
      model: result.provider,
      retrievedDocumentCount: result.retrievedDocumentCount,
    });

    return noStoreJson({
      data: {
        digest,
        skipped: false,
      },
      meta: {
        provider: result.provider,
        retrievedDocumentCount: result.retrievedDocumentCount,
        cacheStatus: result.cacheStatus,
      },
    });
  } catch (error) {
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
          code: error instanceof NewsAgentError ? error.code : "AI_AGENT_UNAVAILABLE",
          message: error instanceof NewsAgentError ? error.message : "定时 Agent 暂时不可用，请稍后重试。",
        },
      },
      error instanceof NewsAgentError ? error.status : 502,
    );
  }
}
