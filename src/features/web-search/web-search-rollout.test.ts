import { describe, expect, it } from "vitest";

import {
  canRunWebSearch,
  getWebSearchRollout,
  WebSearchRolloutError,
} from "./web-search-rollout";

describe("web search rollout", () => {
  it("defaults to manual testing so scheduled runs do not consume quota", () => {
    const rollout = getWebSearchRollout({});

    expect(rollout).toBe("manual");
    expect(canRunWebSearch(rollout, "manual")).toBe(true);
    expect(canRunWebSearch(rollout, "cron")).toBe(false);
  });

  it("only enables cron after the full rollout is selected", () => {
    expect(canRunWebSearch(getWebSearchRollout({ WEB_SEARCH_ROLLOUT: "full" }), "cron")).toBe(true);
    expect(canRunWebSearch(getWebSearchRollout({ WEB_SEARCH_ROLLOUT: "disabled" }), "manual")).toBe(false);
  });

  it("rejects an invalid rollout value", () => {
    expect(() => getWebSearchRollout({ WEB_SEARCH_ROLLOUT: "gradual" })).toThrow(WebSearchRolloutError);
  });
});
