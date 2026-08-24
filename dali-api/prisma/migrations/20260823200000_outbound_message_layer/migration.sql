-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupKey" TEXT;

-- AlterTable
ALTER TABLE "GmailIntegration" ADD COLUMN     "dailyCap" INTEGER;

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "dedupKey" TEXT,
    "purpose" TEXT,
    "senderId" TEXT,
    "target" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "notificationId" TEXT,
    "subject" TEXT,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "slackText" TEXT,
    "ics" TEXT,
    "attachments" JSONB,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "eventType" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderDailyUsage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SenderDailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundMessage_status_nextAttemptAt_idx" ON "OutboundMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_recipientUserId_idx" ON "OutboundMessage"("recipientUserId");

-- CreateIndex
CREATE INDEX "OutboundMessage_senderId_sentAt_idx" ON "OutboundMessage"("senderId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_channel_dedupKey_key" ON "OutboundMessage"("channel", "dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "SenderDailyUsage_senderId_day_key" ON "SenderDailyUsage"("senderId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_recipientUserId_dedupKey_key" ON "Notification"("recipientUserId", "dedupKey");

