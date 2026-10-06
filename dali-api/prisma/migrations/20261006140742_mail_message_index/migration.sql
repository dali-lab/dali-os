-- CreateEnum
CREATE TYPE "MailDirection" AS ENUM ('Inbound', 'Outbound');

-- CreateEnum
CREATE TYPE "MailLinkSource" AS ENUM ('None', 'Auto', 'Manual');

-- AlterTable
ALTER TABLE "MailAccount" ADD COLUMN     "indexBackfilledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MailMessageIndex" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" "MailDirection" NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3) NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedUserId" TEXT,
    "linkSource" "MailLinkSource" NOT NULL DEFAULT 'None',
    "linkedById" TEXT,
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailMessageIndex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailMessageIndex_linkedUserId_sentAt_idx" ON "MailMessageIndex"("linkedUserId", "sentAt");

-- CreateIndex
CREATE INDEX "MailMessageIndex_accountId_threadId_idx" ON "MailMessageIndex"("accountId", "threadId");

-- CreateIndex
CREATE INDEX "MailMessageIndex_accountId_sentAt_idx" ON "MailMessageIndex"("accountId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailMessageIndex_accountId_gmailMessageId_key" ON "MailMessageIndex"("accountId", "gmailMessageId");

-- AddForeignKey
ALTER TABLE "MailMessageIndex" ADD CONSTRAINT "MailMessageIndex_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessageIndex" ADD CONSTRAINT "MailMessageIndex_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessageIndex" ADD CONSTRAINT "MailMessageIndex_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
