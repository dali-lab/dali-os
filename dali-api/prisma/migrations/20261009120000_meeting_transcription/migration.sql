-- Meeting transcription v2 (specs/meeting-transcription.md, PR 1): batch
-- browser/desktop capture + self-hosted Modal diarization, replacing the
-- on-device Apple-recognizer path behind the still-off `ai-meeting-notes`
-- flag.
--
-- DATA-LOSING: "MeetingRecording"."systemAudio" is dropped below. It tracked
-- whether the desktop app captured system audio on-device; it is superseded
-- by the new "channels" array (which channels actually have stored chunks)
-- and was never set in prod while the flag is off. See the PR description.
--
-- "MeetingReminderLog"'s unique index is dropped and recreated with the new
-- "kind" column folded in — existing rows backfill "kind" = 'Reminder' (the
-- column default), so every live reminder keeps its original idempotency key.
--
-- CreateEnum
CREATE TYPE "MeetingReminderKind" AS ENUM ('Reminder', 'RecordPrompt');

-- CreateEnum
CREATE TYPE "RecordingPolicy" AS ENUM ('Allowed', 'Disabled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MeetingRecordingStatus" ADD VALUE 'Processing';
ALTER TYPE "MeetingRecordingStatus" ADD VALUE 'Done';

-- DropIndex
DROP INDEX "MeetingReminderLog_scheduledMeetingId_occurrenceStart_userI_key";

-- AlterTable
ALTER TABLE "MeetingRecording" DROP COLUMN "systemAudio",
ADD COLUMN     "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "chunkIndex" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "insertedAt" TIMESTAMP(3),
ADD COLUMN     "lastChunkAt" TIMESTAMP(3),
ADD COLUMN     "occurrenceStart" TIMESTAMP(3),
ADD COLUMN     "scheduledMeetingId" TEXT,
ADD COLUMN     "segmentStarts" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
ADD COLUMN     "speakers" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "words" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN     "recordPrompt" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "MeetingReminderLog" ADD COLUMN     "kind" "MeetingReminderKind" NOT NULL DEFAULT 'Reminder';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "recordingPolicy" "RecordingPolicy" NOT NULL DEFAULT 'Allowed';

-- CreateIndex
CREATE INDEX "MeetingRecording_scheduledMeetingId_occurrenceStart_idx" ON "MeetingRecording"("scheduledMeetingId", "occurrenceStart");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingReminderLog_scheduledMeetingId_occurrenceStart_userI_key" ON "MeetingReminderLog"("scheduledMeetingId", "occurrenceStart", "userId", "kind");

-- AddForeignKey
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

