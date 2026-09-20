-- A meeting's location and description. Both were collected by the invite form
-- and then dropped on the floor: the create path never carried them, so they
-- reached neither the Google event, the ICS invite, nor the meeting itself.
-- Nullable with no default — existing meetings simply have neither.

-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN     "description" TEXT,
ADD COLUMN     "location" TEXT;
