-- Also email each recipient's Dartmouth address at fire time (composer toggle).
-- Email channel only; in-app/Slack are unaffected.
-- Additive with a default — no backfill, no data loss.
ALTER TABLE "ScheduledAnnouncement" ADD COLUMN "ccDartmouth" BOOLEAN NOT NULL DEFAULT false;
