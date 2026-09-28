-- Stable RFC 5545 UID for the pushed Google event. externalEventId (the mutable
-- per-copy event id) can't tie a fetched event back to its meeting when Google
-- drops recurringEventId on a detached instance; the iCalUID is shared across
-- every attendee copy and every instance of a series, so the calendar joins on
-- it. Additive + nullable; backfilled for existing rows out of band.
-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN "iCalUID" TEXT;

-- CreateIndex
CREATE INDEX "ScheduledMeeting_iCalUID_idx" ON "ScheduledMeeting"("iCalUID");
