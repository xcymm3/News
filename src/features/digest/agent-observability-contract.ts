export type AgentQualityEvaluationSnapshot = {
  evaluationVersion: string;
  freshnessScore: number;
  multiSourceCoverage: number;
  averageSourcesPerStory: number;
  sourceDomainCount: number;
  categoryCoverage: number;
  duplicateFreeRate: number;
  citationUrlValidity: number;
};

export type AgentRunStageSnapshot = {
  stage: "search" | "cluster" | "fetch" | "synthesize" | "validate" | "publish";
  status: "running" | "succeeded" | "failed" | "skipped";
  inputCount?: number;
  outputCount?: number;
  durationMs?: number;
  details?: Record<string, string | number | boolean | null>;
  errorMessage?: string;
};

export type AgentRunEventDecisionSnapshot = {
  phase: "cluster" | "fetch" | "final_selection";
  candidateId: string;
  headline: string;
  decision: "selected" | "rejected";
  reason: string;
  score?: number;
  sourceDomainCount: number;
  candidateCount: number;
  readableSourceCount?: number;
  latestPublishedAt?: string;
  scoreDetails?: Record<string, string | number | boolean | null>;
};

export type AgentRunSnapshot = {
  id: string;
  digestDate: string;
  trigger: "manual" | "cron";
  status: "running" | "succeeded" | "failed";
  model?: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  retrievedDocumentCount?: number;
  publishedStoryCount?: number;
  errorMessage?: string;
  stages: AgentRunStageSnapshot[];
  eventDecisions: AgentRunEventDecisionSnapshot[];
  evaluation?: AgentQualityEvaluationSnapshot;
};

export type AgentRunHistoryItem = Pick<
  AgentRunSnapshot,
  "id" | "digestDate" | "trigger" | "status" | "startedAt" | "completedAt" | "totalDurationMs" | "publishedStoryCount"
> & {
  evaluation?: Pick<AgentQualityEvaluationSnapshot, "freshnessScore" | "multiSourceCoverage" | "duplicateFreeRate">;
};

export type AgentObservabilitySnapshot = {
  latestRun: AgentRunSnapshot | null;
  history: AgentRunHistoryItem[];
};
