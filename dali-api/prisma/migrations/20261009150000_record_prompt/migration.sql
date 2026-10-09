-- Meeting transcription v2 (specs/meeting-transcription.md, PR 2): "Record
-- this meeting?" organizer notification. The desktop feed needs the
-- occurrence's original start to resolve its note/video-link fields
-- (app/routes/api.notifications.ts) and dueAt already carries a different
-- thing on meeting.reminder (the EFFECTIVE start), so this is a new column
-- rather than a reuse.
--
-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "occurrenceStart" TIMESTAMP(3);
