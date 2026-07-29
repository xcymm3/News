export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    {
      error: {
        code: "MANUAL_DIGEST_DISABLED",
        message: "日报仅由每日定时任务自动生成。",
      },
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
