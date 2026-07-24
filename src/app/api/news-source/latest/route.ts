import { LiveNewsSourceError, getLatestLiveNews } from "@/features/news-source/live-news-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getLatestLiveNews();

    return Response.json(
      {
        data: {
          articles: result.articles,
        },
        meta: {
          provider: result.provider,
          sourceNames: result.sourceNames,
          fetchedAt: result.fetchedAt,
          cacheStatus: result.cacheStatus,
          processingState: "raw",
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

    console.error("Failed to fetch the live news source.", error);

    return Response.json(
      {
        error: {
          code: "NEWS_SOURCE_UNAVAILABLE",
          message: "实时新闻源暂时不可用，请稍后重试。",
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
