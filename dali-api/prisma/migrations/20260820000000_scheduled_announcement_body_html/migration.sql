-- Rich-text (sanitized HTML) email body for scheduled announcements, rendered
-- at fire time. In-app/Slack keep using the plain-text `body` mirror.
-- Additive + nullable — no backfill, no data loss.
ALTER TABLE "ScheduledAnnouncement" ADD COLUMN "bodyHtml" TEXT;
