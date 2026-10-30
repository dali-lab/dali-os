ALTER TABLE "MeetingRecording" ADD COLUMN "captureSource" TEXT;
ALTER TABLE "MeetingRecording" ADD COLUMN "appVersion" TEXT;
ALTER TABLE "MeetingRecording" ADD COLUMN "clientPlatform" TEXT;
ALTER TABLE "MeetingRecording" ADD COLUMN "audioDeletedAt" TIMESTAMP(3);

-- Rows finalized before this migration already had their audio deleted.
UPDATE "MeetingRecording" SET "audioDeletedAt" = "finalizedAt" WHERE "finalizedAt" IS NOT NULL;
