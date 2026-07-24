import {
  DigestNotFoundError,
  digestService,
} from "@/features/digest/digest-service";
import { getDigestDataMode } from "@/features/digest/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const digest = await digestService.getTodayDigest();

    return Response.json(
      {
        data: digest,
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

    console.error("Failed to read today's digest.", error);

    return Response.json(
      {
        error: {
          code: "DIGEST_UNAVAILABLE",
          message: "暂时无法读取今日简报，请稍后重试。",
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
