-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('OFFICIAL', 'WIRE', 'MEDIA');
CREATE TYPE "ArticleLanguage" AS ENUM ('ZH', 'EN', 'OTHER');
CREATE TYPE "ArticleStatus" AS ENUM ('ACTIVE', 'SUPPRESSED');
CREATE TYPE "StoryStatus" AS ENUM ('CANDIDATE', 'REVIEW', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "ClaimKind" AS ENUM ('FACT', 'ANALYSIS');
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'VERIFIED', 'DISPUTED', 'REJECTED');
CREATE TYPE "DigestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');
CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "AgentRunTrigger" AS ENUM ('MANUAL', 'CRON');
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "NewsSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "trustScore" INTEGER NOT NULL DEFAULT 50,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NewsSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "language" "ArticleLanguage" NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'ACTIVE',
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoryCluster" (
    "id" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT,
    "whyItMatters" TEXT,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "StoryStatus" NOT NULL DEFAULT 'CANDIDATE',
    "startedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoryCluster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClusterArticle" (
    "storyId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClusterArticle_pkey" PRIMARY KEY ("storyId", "articleId")
);

CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" "ClaimKind" NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClaimCitation" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "supportingExcerpt" TEXT NOT NULL,
    "citationOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimCitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Digest" (
    "id" TEXT NOT NULL,
    "digestDate" DATE NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "DigestStatus" NOT NULL DEFAULT 'DRAFT',
    "generationMode" TEXT,
    "notice" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Digest_pkey" PRIMARY KEY ("id")
);

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

CREATE TABLE "DigestItem" (
    "id" TEXT NOT NULL,
    "digestId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "headlineSnapshot" TEXT NOT NULL,
    "summarySnapshot" TEXT NOT NULL,
    "impactSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DigestItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "anonymousSessionHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessageCitation" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "supportingExcerpt" TEXT NOT NULL,
    "citationOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessageCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsSource_domain_key" ON "NewsSource"("domain");
CREATE UNIQUE INDEX "Article_canonicalUrl_key" ON "Article"("canonicalUrl");
CREATE INDEX "Article_publishedAt_idx" ON "Article"("publishedAt");
CREATE INDEX "Article_contentHash_idx" ON "Article"("contentHash");
CREATE UNIQUE INDEX "Article_sourceId_externalId_key" ON "Article"("sourceId", "externalId");
CREATE INDEX "StoryCluster_importanceScore_idx" ON "StoryCluster"("importanceScore");
CREATE INDEX "StoryCluster_lastEventAt_idx" ON "StoryCluster"("lastEventAt");
CREATE INDEX "ClusterArticle_articleId_idx" ON "ClusterArticle"("articleId");
CREATE INDEX "Claim_storyId_status_idx" ON "Claim"("storyId", "status");
CREATE INDEX "ClaimCitation_articleId_idx" ON "ClaimCitation"("articleId");
CREATE UNIQUE INDEX "ClaimCitation_claimId_citationOrder_key" ON "ClaimCitation"("claimId", "citationOrder");
CREATE INDEX "Digest_digestDate_status_idx" ON "Digest"("digestDate", "status");
CREATE UNIQUE INDEX "Digest_digestDate_revision_key" ON "Digest"("digestDate", "revision");
CREATE INDEX "AgentRun_digestDate_status_idx" ON "AgentRun"("digestDate", "status");
CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");
CREATE INDEX "DigestItem_storyId_idx" ON "DigestItem"("storyId");
CREATE UNIQUE INDEX "DigestItem_digestId_storyId_key" ON "DigestItem"("digestId", "storyId");
CREATE UNIQUE INDEX "DigestItem_digestId_position_key" ON "DigestItem"("digestId", "position");
CREATE INDEX "ChatThread_expiresAt_idx" ON "ChatThread"("expiresAt");
CREATE UNIQUE INDEX "ChatThread_storyId_anonymousSessionHash_key" ON "ChatThread"("storyId", "anonymousSessionHash");
CREATE UNIQUE INDEX "ChatMessage_threadId_sequence_key" ON "ChatMessage"("threadId", "sequence");
CREATE INDEX "ChatMessageCitation_articleId_idx" ON "ChatMessageCitation"("articleId");
CREATE UNIQUE INDEX "ChatMessageCitation_messageId_citationOrder_key" ON "ChatMessageCitation"("messageId", "citationOrder");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NewsSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClusterArticle" ADD CONSTRAINT "ClusterArticle_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "StoryCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClusterArticle" ADD CONSTRAINT "ClusterArticle_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "StoryCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimCitation" ADD CONSTRAINT "ClaimCitation_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimCitation" ADD CONSTRAINT "ClaimCitation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "Digest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DigestItem" ADD CONSTRAINT "DigestItem_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "Digest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DigestItem" ADD CONSTRAINT "DigestItem_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "StoryCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "StoryCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessageCitation" ADD CONSTRAINT "ChatMessageCitation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessageCitation" ADD CONSTRAINT "ChatMessageCitation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
