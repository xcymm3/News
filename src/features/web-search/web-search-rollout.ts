export const WEB_SEARCH_ROLLOUTS = ["disabled", "full"] as const;

export type WebSearchRollout = (typeof WEB_SEARCH_ROLLOUTS)[number];

export class WebSearchRolloutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSearchRolloutError";
  }
}

export function getWebSearchRollout(environment: Record<string, string | undefined> = process.env): WebSearchRollout {
  const configuredValue = environment.WEB_SEARCH_ROLLOUT?.trim().toLowerCase();

  if (!configuredValue) {
    return "full";
  }

  if (!WEB_SEARCH_ROLLOUTS.includes(configuredValue as WebSearchRollout)) {
    throw new WebSearchRolloutError("WEB_SEARCH_ROLLOUT 只能是 disabled 或 full。");
  }

  return configuredValue as WebSearchRollout;
}

export function canRunWebSearch(rollout: WebSearchRollout) {
  return rollout === "full";
}

export function getWebSearchRolloutMessage(rollout: WebSearchRollout) {
  if (rollout === "disabled") {
    return "全网搜索 Agent 当前处于关闭状态。";
  }

  return "全网搜索 Agent 当前未启用。";
}
