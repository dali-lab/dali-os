-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "slackBlocks" JSONB,
ADD COLUMN     "slackFileKey" TEXT,
ADD COLUMN     "slackTs" TEXT;
