CREATE TABLE "AgentRunEventDecision" (
  "id" TEXT NOT NULL,
  "agentRunId" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "headline" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "score" DOUBLE PRECISION,
  "sourceDomainCount" INTEGER NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "readableSourceCount" INTEGER,
  "latestPublishedAt" TIMESTAMP(3),
  "scoreDetails" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentRunEventDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentRunEventDecision_agentRunId_phase_candidateId_key"
  ON "AgentRunEventDecision"("agentRunId", "phase", "candidateId");

CREATE INDEX "AgentRunEventDecision_agentRunId_phase_decision_idx"
  ON "AgentRunEventDecision"("agentRunId", "phase", "decision");

CREATE INDEX "AgentRunEventDecision_createdAt_idx"
  ON "AgentRunEventDecision"("createdAt");

ALTER TABLE "AgentRunEventDecision"
  ADD CONSTRAINT "AgentRunEventDecision_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
