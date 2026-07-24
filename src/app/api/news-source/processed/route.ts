import { LiveNewsSourceError } from "@/features/news-source/live-news-source";
import { getProcessedLiveNews } from "@/features/news-source/processed-news-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getProcessedLiveNews();

    return Response.json(
      {
        data: {
          clusters: result.clusters,
          stats: result.stats,
        },
        meta: {
          provider: result.provider,
          sourceNames: result.sourceNames,
          fetchedAt: result.fetchedAt,
          cacheStatus: result.cacheStatus,
          processingState: "candidate",
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof LiveNewsSourceError) {
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

    console.error("Failed to process live news articles.", error);

    return Response.json(
      {
        error: {
          code: "NEWS_PROCESSING_UNAVAILABLE",
          message: "暂时无法处理实时新闻，请稍后重试。",
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
