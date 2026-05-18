-- CreateEnum
CREATE TYPE "SlackBugReportStatus" AS ENUM ('Pending', 'Filed', 'Cancelled', 'Failed');

-- CreateTable
CREATE TABLE "SlackBugReportDraft" (
    "id" TEXT NOT NULL,
    "slackChannelId" TEXT NOT NULL,
    "slackThreadTs" TEXT NOT NULL,
    "previewMessageTs" TEXT NOT NULL,
    "threadJson" JSONB NOT NULL,
    "status" "SlackBugReportStatus" NOT NULL DEFAULT 'Pending',
    "githubIssueNumber" INTEGER,
    "githubIssueUrl" TEXT,
    "requestedBySlackUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlackBugReportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlackBugReportDraft_slackChannelId_previewMessageTs_key" ON "SlackBugReportDraft"("slackChannelId", "previewMessageTs");

-- CreateIndex
CREATE INDEX "SlackBugReportDraft_status_idx" ON "SlackBugReportDraft"("status");
