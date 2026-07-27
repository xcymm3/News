export const WEB_SEARCH_ROLLOUTS = ["disabled", "manual", "full"] as const;

export type WebSearchRollout = (typeof WEB_SEARCH_ROLLOUTS)[number];
export type WebSearchTrigger = "manual" | "cron";

export class WebSearchRolloutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSearchRolloutError";
  }
}

export function getWebSearchRollout(environment: Record<string, string | undefined> = process.env): WebSearchRollout {
  const configuredValue = environment.WEB_SEARCH_ROLLOUT?.trim().toLowerCase();

  if (!configuredValue) {
    return "manual";
  }

  if (!WEB_SEARCH_ROLLOUTS.includes(configuredValue as WebSearchRollout)) {
    throw new WebSearchRolloutError("WEB_SEARCH_ROLLOUT 只能是 disabled、manual 或 full。");
  }

  return configuredValue as WebSearchRollout;
}

export function canRunWebSearch(rollout: WebSearchRollout, trigger: WebSearchTrigger) {
  return rollout === "full" || (rollout === "manual" && trigger === "manual");
}

export function getWebSearchRolloutMessage(rollout: WebSearchRollout, trigger: WebSearchTrigger) {
  if (rollout === "disabled") {
    return "全网搜索 Agent 当前处于关闭状态。";
  }

  if (rollout === "manual" && trigger === "cron") {
    return "全网搜索 Agent 当前仅允许手动测试，定时任务已安全跳过。";
  }

  return "全网搜索 Agent 当前未启用。";
}
