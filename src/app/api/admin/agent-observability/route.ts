import { getAgentObservabilitySnapshot } from "@/features/digest/agent-observability-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getAgentObservabilitySnapshot();

    return Response.json(
      {
        data: snapshot,
        meta: {
          servedAt: new Date().toISOString(),
          historyLimit: 14,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Failed to read Agent observability data.", error);

    return Response.json(
      {
        error: {
          code: "AGENT_OBSERVABILITY_UNAVAILABLE",
          message: "暂时无法读取 Agent 运行记录，请稍后重试。",
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
