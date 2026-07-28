import { describe, expect, it } from "vitest";

import type { WebSearchCandidate } from "./web-search-contract";
import {
  clusterWebSearchCandidates,
  selectDistinctDomainCandidates,
  selectMultiSourceClusters,
} from "./event-clustering";

function candidate({
  title,
  domain,
  url,
}: {
  title: string;
  domain: string;
  url: string;
}): WebSearchCandidate {
  return {
    id: url,
    title,
    snippet: "用于聚类的候选摘要。",
    canonicalUrl: url,
    sourceName: domain,
    sourceDomain: domain,
    language: "zh-CN",
    publishedAt: "2026-07-28T02:00:00.000Z",
  };
}

describe("event clustering", () => {
  it("groups independently reported variants of the same event", () => {
    const clusters = clusterWebSearchCandidates([
      candidate({ title: "多国就红海航运安全举行紧急磋商", domain: "news-a.example", url: "https://news-a.example/1" }),
      candidate({ title: "红海航运安全紧急磋商 多国代表参加", domain: "news-b.example", url: "https://news-b.example/1" }),
      candidate({ title: "多国代表讨论红海航运安全问题", domain: "news-c.example", url: "https://news-c.example/1" }),
      candidate({ title: "欧洲央行公布最新利率决议", domain: "finance.example", url: "https://finance.example/1" }),
    ]);

    const selected = selectMultiSourceClusters(clusters, { minimumSourceDomains: 3, maximumClusters: 12 });

    expect(selected).toHaveLength(1);
    expect(selected[0]).toEqual(expect.objectContaining({ sourceDomainCount: 3 }));
    expect(selectDistinctDomainCandidates(selected[0]!, 5)).toHaveLength(3);
  });

  it("does not treat repeated pages from one domain as multi-source evidence", () => {
    const clusters = clusterWebSearchCandidates([
      candidate({ title: "多国就红海航运安全举行紧急磋商", domain: "news-a.example", url: "https://news-a.example/1" }),
      candidate({ title: "红海航运安全紧急磋商 多国代表参加", domain: "news-a.example", url: "https://news-a.example/2" }),
      candidate({ title: "红海航运安全紧急磋商 多国代表参加", domain: "news-b.example", url: "https://news-b.example/1" }),
    ]);

    expect(selectMultiSourceClusters(clusters, { minimumSourceDomains: 3, maximumClusters: 12 })).toEqual([]);
  });
});
