-- Attendance, meeting-sourced hours and meeting notes become per-occurrence.
-- ScheduledMeeting is one row per series, and all three were keyed on the
-- meeting alone, so every occurrence of a recurring meeting opened the first
-- occurrence's note and roster, and marking someone present for a later week
-- overwrote their first week's hours.
--
-- Each gets the occurrence's ORIGINAL start as a key (see resolveOccurrence in
-- app/lib/meeting-occurrences.ts). Existing rows are backfilled to the series'
-- first occurrence (selectedAt; createdAt for a meeting that was never
-- scheduled), which is exactly what they meant before: a one-off meeting's
-- only occurrence, or the one row a series had.
--
-- Unique-key rewrites (no data loss):
--   * MeetingAttendance (scheduledMeetingId, userId)
--       -> (scheduledMeetingId, occurrenceStart, userId)
--   * TimeEntry (scheduledMeetingId, userId)
--       -> (scheduledMeetingId, occurrenceStart, userId)
--   * Page.meetingNoteId unique -> (meetingNoteId, meetingOccurrenceStart)

-- DropIndex
DROP INDEX "MeetingAttendance_scheduledMeetingId_userId_key";

-- DropIndex
DROP INDEX "TimeEntry_scheduledMeetingId_userId_key";

-- DropIndex
DROP INDEX "Page_meetingNoteId_key";

-- AlterTable
ALTER TABLE "MeetingAttendance" ADD COLUMN "occurrenceStart" TIMESTAMP(3);

UPDATE "MeetingAttendance" a
SET "occurrenceStart" = COALESCE(m."selectedAt", m."createdAt")
FROM "ScheduledMeeting" m
WHERE m."id" = a."scheduledMeetingId";

ALTER TABLE "MeetingAttendance" ALTER COLUMN "occurrenceStart" SET NOT NULL;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "occurrenceStart" TIMESTAMP(3);

UPDATE "TimeEntry" t
SET "occurrenceStart" = COALESCE(m."selectedAt", m."createdAt")
FROM "ScheduledMeeting" m
WHERE m."id" = t."scheduledMeetingId";

-- AlterTable
ALTER TABLE "Page" ADD COLUMN "meetingOccurrenceStart" TIMESTAMP(3);

UPDATE "Page" p
SET "meetingOccurrenceStart" = COALESCE(m."selectedAt", m."createdAt")
FROM "ScheduledMeeting" m
WHERE m."id" = p."meetingNoteId";

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAttendance_scheduledMeetingId_occurrenceStart_userId_key" ON "MeetingAttendance"("scheduledMeetingId", "occurrenceStart", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_scheduledMeetingId_occurrenceStart_userId_key" ON "TimeEntry"("scheduledMeetingId", "occurrenceStart", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_meetingNoteId_meetingOccurrenceStart_key" ON "Page"("meetingNoteId", "meetingOccurrenceStart");
