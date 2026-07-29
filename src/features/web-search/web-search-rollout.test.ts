import { describe, expect, it } from "vitest";

import {
  canRunWebSearch,
  getWebSearchRollout,
  WebSearchRolloutError,
} from "./web-search-rollout";

describe("web search rollout", () => {
  it("defaults to the scheduled daily run", () => {
    const rollout = getWebSearchRollout({});

    expect(rollout).toBe("full");
    expect(canRunWebSearch(rollout)).toBe(true);
  });

  it("only enables cron after the full rollout is selected", () => {
    expect(canRunWebSearch(getWebSearchRollout({ WEB_SEARCH_ROLLOUT: "full" }))).toBe(true);
    expect(canRunWebSearch(getWebSearchRollout({ WEB_SEARCH_ROLLOUT: "disabled" }))).toBe(false);
  });

  it("rejects an invalid rollout value", () => {
    expect(() => getWebSearchRollout({ WEB_SEARCH_ROLLOUT: "gradual" })).toThrow(WebSearchRolloutError);
  });
});
