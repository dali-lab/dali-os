-- Link a TimeEntry to the calendar event it was logged against ("count this as
-- work" on an event), so the event and its hours are one thing rather than two
-- overlapping blocks.
-- Additive-only — both columns are nullable. Non-data-losing.

ALTER TABLE "TimeEntry" ADD COLUMN "sourceEventId" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN "sourceCalendarLinkId" TEXT;

-- One work log per event per user. NULLs are distinct in Postgres, so the many
-- existing entries with no source event are unaffected.
CREATE UNIQUE INDEX "TimeEntry_sourceEventId_userId_key" ON "TimeEntry"("sourceEventId", "userId");
