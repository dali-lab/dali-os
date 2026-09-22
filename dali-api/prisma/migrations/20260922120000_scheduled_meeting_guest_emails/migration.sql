-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN "guestEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
