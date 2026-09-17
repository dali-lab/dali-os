-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN     "guestsCanInviteOthers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "guestsCanModify" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "guestsCanSeeGuestList" BOOLEAN NOT NULL DEFAULT true;
