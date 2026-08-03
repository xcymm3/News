CREATE TYPE "AgentRunStageName" AS ENUM (
  'SEARCH',
  'CLUSTER',
  'FETCH',
  'SYNTHESIZE',
  'VALIDATE',
  'PUBLISH'
);

CREATE TYPE "AgentRunStageStatus" AS ENUM (
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED'
);

CREATE TABLE "AgentRunStage" (
  "id" TEXT NOT NULL,
  "agentRunId" TEXT NOT NULL,
  "stage" "AgentRunStageName" NOT NULL,
  "position" INTEGER NOT NULL,
  "status" "AgentRunStageStatus" NOT NULL DEFAULT 'RUNNING',
  "inputCount" INTEGER,
  "outputCount" INTEGER,
  "durationMs" INTEGER,
  "details" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AgentRunStage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentRunQualityEvaluation" (
  "id" TEXT NOT NULL,
  "agentRunId" TEXT NOT NULL,
  "evaluationVersion" TEXT NOT NULL,
  "freshnessScore" DOUBLE PRECISION NOT NULL,
  "multiSourceCoverage" DOUBLE PRECISION NOT NULL,
  "averageSourcesPerStory" DOUBLE PRECISION NOT NULL,
  "sourceDomainCount" INTEGER NOT NULL,
  "categoryCoverage" DOUBLE PRECISION NOT NULL,
  "duplicateFreeRate" DOUBLE PRECISION NOT NULL,
  "citationUrlValidity" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentRunQualityEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentRunStage_agentRunId_stage_key"
  ON "AgentRunStage"("agentRunId", "stage");

CREATE UNIQUE INDEX "AgentRunStage_agentRunId_position_key"
  ON "AgentRunStage"("agentRunId", "position");

CREATE INDEX "AgentRunStage_agentRunId_position_idx"
  ON "AgentRunStage"("agentRunId", "position");

CREATE INDEX "AgentRunStage_stage_status_idx"
  ON "AgentRunStage"("stage", "status");

CREATE UNIQUE INDEX "AgentRunQualityEvaluation_agentRunId_key"
  ON "AgentRunQualityEvaluation"("agentRunId");

CREATE INDEX "AgentRunQualityEvaluation_evaluationVersion_idx"
  ON "AgentRunQualityEvaluation"("evaluationVersion");

ALTER TABLE "AgentRunStage"
  ADD CONSTRAINT "AgentRunStage_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentRunQualityEvaluation"
  ADD CONSTRAINT "AgentRunQualityEvaluation_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
