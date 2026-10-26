-- Wall-clock start of the live session, so a page that remounts mid-recording
-- can rebuild its clock instead of restarting it.
ALTER TABLE "MeetingRecording" ADD COLUMN "sessionStartedAt" TIMESTAMP(3);
