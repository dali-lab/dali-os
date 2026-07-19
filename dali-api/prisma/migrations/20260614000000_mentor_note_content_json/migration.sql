-- Mentorship notes are single-author Tiptap (no Yjs/Hocuspocus). Swap the
-- never-populated contentDocId pointer for an inline ProseMirror JSON column.
-- MentorNote / MentorNoteTemplate ship in 20260514040346_v0_phase1_additive but
-- have no readers or writers yet, so the column drop is safe.

ALTER TABLE "MentorNote" DROP COLUMN "contentDocId";
ALTER TABLE "MentorNote" ADD COLUMN "contentJson" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "MentorNoteTemplate" DROP COLUMN "contentDocId";
ALTER TABLE "MentorNoteTemplate" ADD COLUMN "contentJson" JSONB NOT NULL DEFAULT '{}';
