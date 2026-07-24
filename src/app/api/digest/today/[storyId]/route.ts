import {
  DigestNotFoundError,
  digestService,
} from "@/features/digest/digest-service";
import { getDigestDataMode } from "@/features/digest/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;

  try {
    const digest = await digestService.getTodayDigest();
    const story = digest.stories.find((item) => item.id === storyId);

    if (!story) {
      return Response.json(
        {
          error: {
            code: "STORY_NOT_FOUND",
            message: "今日简报中未找到该事件。",
          },
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return Response.json(
      {
        data: {
          story,
          digest: {
            id: digest.id,
            digestDate: digest.digestDate,
            revision: digest.revision,
            publishedAt: digest.publishedAt,
          },
        },
        meta: {
          dataMode: getDigestDataMode(digest),
          servedAt: new Date().toISOString(),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof DigestNotFoundError) {
      return Response.json(
        {
          error: {
            code: "DIGEST_NOT_FOUND",
            message: "今日简报暂未发布。",
          },
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    console.error("Failed to read a digest story.", error);

    return Response.json(
      {
        error: {
          code: "STORY_UNAVAILABLE",
          message: "暂时无法读取该事件，请稍后重试。",
        },
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
