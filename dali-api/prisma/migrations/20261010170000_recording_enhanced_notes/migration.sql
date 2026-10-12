-- Meeting notes model (specs/meeting-notes-model.md, section 2): Enhance
-- stores its last server-verified merge plan on the recording row, and marks
-- when/by whom it was applied. All three columns are nullable additions —
-- no backfill, no data loss.
ALTER TABLE "MeetingRecording" ADD COLUMN "notes" JSONB;
ALTER TABLE "MeetingRecording" ADD COLUMN "enhancedAt" TIMESTAMP(3);
ALTER TABLE "MeetingRecording" ADD COLUMN "enhancedBy" TEXT;
