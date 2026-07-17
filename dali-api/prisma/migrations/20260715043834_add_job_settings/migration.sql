-- AlterTable
ALTER TABLE "ScheduledJob" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

