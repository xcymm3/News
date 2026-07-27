-- Extend the original digest schema with publication metadata and Agent run records.
CREATE TYPE "AgentRunTrigger" AS ENUM ('MANUAL', 'CRON');
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "Digest"
  ADD COLUMN "generationMode" TEXT,
  ADD COLUMN "notice" TEXT;

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "digestDate" DATE NOT NULL,
    "trigger" "AgentRunTrigger" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT,
    "retrievedDocumentCount" INTEGER,
    "publishedStoryCount" INTEGER,
    "errorMessage" TEXT,
    "digestId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentRun_digestDate_status_idx" ON "AgentRun"("digestDate", "status");
CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");

ALTER TABLE "AgentRun"
  ADD CONSTRAINT "AgentRun_digestId_fkey"
  FOREIGN KEY ("digestId") REFERENCES "Digest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
