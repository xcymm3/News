export type DigestCitation = {
  id: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  supportingExcerpt: string;
};

export type DigestStory = {
  id: string;
  position: number;
  headline: string;
  summary: string;
  whyItMatters: string;
  importanceScore: number;
  updatedAt: string;
  citations: DigestCitation[];
};

export type DailyDigest = {
  id: string;
  digestDate: string;
  revision: number;
  publishedAt: string;
  isDemoData: boolean;
  generationMode?: "rules" | "agent";
  notice?: string;
  stories: DigestStory[];
};

export type DigestDataMode = "demo" | "generated" | "agent";

export function getDigestDataMode(digest: DailyDigest): DigestDataMode {
  if (digest.isDemoData) {
    return "demo";
  }

  return digest.generationMode === "agent" ? "agent" : "generated";
}
