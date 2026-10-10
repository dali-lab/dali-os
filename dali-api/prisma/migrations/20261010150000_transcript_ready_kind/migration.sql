-- Meeting notes model (specs/meeting-notes-model.md, section 5): the
-- post-meeting nudge needs its own MeetingReminderLog idempotency kind.
-- Single statement on purpose: Postgres can't add an enum value in the same
-- transaction as other statements that might reference it.
ALTER TYPE "MeetingReminderKind" ADD VALUE 'TranscriptReady';
