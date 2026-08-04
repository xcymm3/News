import {
  AgentRunStageName,
  AgentRunStageStatus,
  AgentRunStatus,
  AgentRunTrigger,
  Prisma,
} from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/prisma";

import type {
  AgentObservabilitySnapshot,
  AgentRunEventDecisionSnapshot,
  AgentRunHistoryItem,
  AgentRunSnapshot,
} from "./agent-observability-contract";

export type {
  AgentObservabilitySnapshot,
  AgentQualityEvaluationSnapshot,
  AgentRunEventDecisionSnapshot,
  AgentRunHistoryItem,
  AgentRunSnapshot,
  AgentRunStageSnapshot,
} from "./agent-observability-contract";

const HISTORY_LIMIT = 14;
const PUBLIC_ERROR_MESSAGE_MAX_LENGTH = 240;
const SAFE_OBSERVABILITY_DETAIL_KEYS = new Set([
  "successfulTopicCount",
  "skippedTopicCount",
  "rssConfiguredSourceCount",
  "rssAvailableSourceCount",
  "rssArticleCount",
  "rssCandidateCount",
  "rssChinanewsCount",
  "rss36KrCount",
  "rssCnaInternationalCount",
  "rssIthomeCount",
  "rssHuxiuCount",
  "bochaCandidateCount",
  "searchRetryCount",
  "searchFailureReason",
  "minimumSourceDomains",
  "maximumClusters",
  "insufficientSourceRejectedCount",
  "maximumSourcesPerEvent",
  "rssSelectedCandidateCount",
  "bochaSelectedCandidateCount",
  "fetchRetryCount",
  "fetchFailedCount",
  "fetchFailureReason",
  "sourceDocumentCount",
  "model",
  "maxRetriesPerEvent",
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "estimatedCostCny",
  "llmRetryCount",
  "llmFallbackEventCount",
  "llmFailureReason",
  "freshnessScore",
  "sourceScore",
  "corroborationScore",
  "ageHours",
]);

type PublicRunStatus = "running" | "succeeded" | "failed";
type PublicRunTrigger = "manual" | "cron";
type PublicStageName = "search" | "cluster" | "fetch" | "synthesize" | "validate" | "publish";
type PublicStageStatus = "running" | "succeeded" | "failed" | "skipped";
type SafeStageDetails = Record<string, string | number | boolean | null>;

type DatabaseStage = {
  stage: AgentRunStageName;
  status: AgentRunStageStatus;
  inputCount: number | null;
  outputCount: number | null;
  durationMs: number | null;
  details: Prisma.JsonValue | null;
  errorMessage: string | null;
};

type DatabaseEvaluation = {
  evaluationVersion: string;
  freshnessScore: number;
  multiSourceCoverage: number;
  averageSourcesPerStory: number;
  sourceDomainCount: number;
  categoryCoverage: number;
  duplicateFreeRate: number;
  citationUrlValidity: number;
};

type DatabaseEventDecision = {
  phase: string;
  candidateId: string;
  headline: string;
  decision: string;
  reason: string;
  score: number | null;
  sourceDomainCount: number;
  candidateCount: number;
  readableSourceCount: number | null;
  latestPublishedAt: Date | null;
  scoreDetails: Prisma.JsonValue | null;
};

type DatabaseRun = {
  id: string;
  digestDate: Date;
  trigger: AgentRunTrigger;
  status: AgentRunStatus;
  model: string | null;
  retrievedDocumentCount: number | null;
  publishedStoryCount: number | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  stages: DatabaseStage[];
  eventDecisions: DatabaseEventDecision[];
  qualityEvaluation: DatabaseEvaluation | null;
};

function toRunStatus(status: AgentRunStatus): PublicRunStatus {
  return status.toLowerCase() as PublicRunStatus;
}

function toRunTrigger(trigger: AgentRunTrigger): PublicRunTrigger {
  return trigger.toLowerCase() as PublicRunTrigger;
}

function toStageName(stage: AgentRunStageName): PublicStageName {
  return stage.toLowerCase() as PublicStageName;
}

function toStageStatus(status: AgentRunStageStatus): PublicStageStatus {
  return status.toLowerCase() as PublicStageStatus;
}

function toPublicDate(value: Date) {
  return value.toISOString();
}

function toDigestDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getTotalDurationMs(startedAt: Date, completedAt: Date | null) {
  return completedAt ? Math.max(completedAt.valueOf() - startedAt.valueOf(), 0) : undefined;
}

function redactPublicErrorMessage(value: string | null) {
  if (!value) {
    return undefined;
  }

  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/\b(sk|api)[-_][A-Za-z0-9_-]{8,}\b/gi, "[已隐藏]")
    .replace(/\b(api[_ -]?key|authorization|token|secret)\s*[:=]\s*\S+/gi, "$1=[已隐藏]")
    .replace(/https?:\/\/\S+/gi, "[链接已隐藏]")
    .slice(0, PUBLIC_ERROR_MESSAGE_MAX_LENGTH);
}

function isSafeDetailKey(key: string) {
  return SAFE_OBSERVABILITY_DETAIL_KEYS.has(key);
}

function toSafeStageDetails(value: Prisma.JsonValue | null) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }

  const details = Object.entries(value).reduce<SafeStageDetails>((result, [key, item]) => {
    if (
      isSafeDetailKey(key)
      && (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null)
    ) {
      result[key] = item;
    }

    return result;
  }, {});

  return Object.keys(details).length > 0 ? details : undefined;
}

function toEvaluationSnapshot(evaluation: DatabaseEvaluation | null) {
  if (!evaluation) {
    return undefined;
  }

  return {
    evaluationVersion: evaluation.evaluationVersion,
    freshnessScore: evaluation.freshnessScore,
    multiSourceCoverage: evaluation.multiSourceCoverage,
    averageSourcesPerStory: evaluation.averageSourcesPerStory,
    sourceDomainCount: evaluation.sourceDomainCount,
    categoryCoverage: evaluation.categoryCoverage,
    duplicateFreeRate: evaluation.duplicateFreeRate,
    citationUrlValidity: evaluation.citationUrlValidity,
  };
}

function toEventDecisionSnapshot(decision: DatabaseEventDecision): AgentRunEventDecisionSnapshot {
  return {
    phase: decision.phase.toLowerCase() as AgentRunEventDecisionSnapshot["phase"],
    candidateId: decision.candidateId,
    headline: decision.headline,
    decision: decision.decision.toLowerCase() as AgentRunEventDecisionSnapshot["decision"],
    reason: decision.reason,
    score: decision.score ?? undefined,
    sourceDomainCount: decision.sourceDomainCount,
    candidateCount: decision.candidateCount,
    readableSourceCount: decision.readableSourceCount ?? undefined,
    latestPublishedAt: decision.latestPublishedAt?.toISOString(),
    scoreDetails: toSafeStageDetails(decision.scoreDetails),
  };
}

export function toAgentRunSnapshot(run: DatabaseRun): AgentRunSnapshot {
  return {
    id: run.id,
    digestDate: toDigestDate(run.digestDate),
    trigger: toRunTrigger(run.trigger),
    status: toRunStatus(run.status),
    model: run.model ?? undefined,
    startedAt: toPublicDate(run.startedAt),
    completedAt: run.completedAt ? toPublicDate(run.completedAt) : undefined,
    totalDurationMs: getTotalDurationMs(run.startedAt, run.completedAt),
    retrievedDocumentCount: run.retrievedDocumentCount ?? undefined,
    publishedStoryCount: run.publishedStoryCount ?? undefined,
    errorMessage: redactPublicErrorMessage(run.errorMessage),
    stages: run.stages.map((stage) => ({
      stage: toStageName(stage.stage),
      status: toStageStatus(stage.status),
      inputCount: stage.inputCount ?? undefined,
      outputCount: stage.outputCount ?? undefined,
      durationMs: stage.durationMs ?? undefined,
      details: toSafeStageDetails(stage.details),
      errorMessage: redactPublicErrorMessage(stage.errorMessage),
    })),
    eventDecisions: run.eventDecisions.map(toEventDecisionSnapshot),
    evaluation: toEvaluationSnapshot(run.qualityEvaluation),
  };
}

function toAgentRunHistoryItem(run: DatabaseRun): AgentRunHistoryItem {
  const snapshot = toAgentRunSnapshot(run);

  return {
    id: snapshot.id,
    digestDate: snapshot.digestDate,
    trigger: snapshot.trigger,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    totalDurationMs: snapshot.totalDurationMs,
    publishedStoryCount: snapshot.publishedStoryCount,
    evaluation: snapshot.evaluation
      ? {
        freshnessScore: snapshot.evaluation.freshnessScore,
        multiSourceCoverage: snapshot.evaluation.multiSourceCoverage,
        duplicateFreeRate: snapshot.evaluation.duplicateFreeRate,
      }
      : undefined,
  };
}

const AGENT_RUN_INCLUDE = {
  stages: {
    orderBy: { position: "asc" },
  },
  qualityEvaluation: true,
  eventDecisions: {
    orderBy: [{ phase: "asc" }, { decision: "asc" }, { score: "desc" }],
  },
} satisfies Prisma.AgentRunInclude;

export async function getAgentObservabilitySnapshot(): Promise<AgentObservabilitySnapshot> {
  const prisma = getPrismaClient();
  const [latestRun, history] = await Promise.all([
    prisma.agentRun.findFirst({
      orderBy: { startedAt: "desc" },
      include: AGENT_RUN_INCLUDE,
    }),
    prisma.agentRun.findMany({
      orderBy: { startedAt: "desc" },
      take: HISTORY_LIMIT,
      include: AGENT_RUN_INCLUDE,
    }),
  ]);

  return {
    latestRun: latestRun ? toAgentRunSnapshot(latestRun) : null,
    history: history.map(toAgentRunHistoryItem),
  };
}
