ALTER TABLE "MeetingRecording" ADD COLUMN "micDevice" TEXT;
ALTER TABLE "MeetingRecording" ADD COLUMN "systemAudioAllowed" BOOLEAN;
ALTER TABLE "MeetingRecording" ADD COLUMN "micSilent" BOOLEAN NOT NULL DEFAULT false;
