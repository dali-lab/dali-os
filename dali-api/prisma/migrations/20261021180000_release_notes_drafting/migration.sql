-- AlterTable
ALTER TABLE "ReleaseNote" ADD COLUMN "draftNote" TEXT;

-- AlterTable
ALTER TABLE "ScheduledJob" ADD COLUMN "state" JSONB;
