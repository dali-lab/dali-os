-- AlterTable
ALTER TABLE "InterviewConfig" ADD COLUMN "rescheduleNoticeHours" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "InterviewConfig" ADD COLUMN "cancelNoticeHours" INTEGER NOT NULL DEFAULT 0;
