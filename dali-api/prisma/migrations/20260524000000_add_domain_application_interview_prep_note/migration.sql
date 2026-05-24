-- Free-form "things to bring up in the interview" note, written by leads during
-- Initial delibs and shown read-only on the interview page. Edited live as a
-- collaborative doc (domainApplication:{id}:prepNote); this column is the
-- plaintext mirror synced back on every save.
--
-- Nullable on purpose (no default): existing rows stay null until a note is
-- written, so this is a purely additive, non-data-losing migration.

ALTER TABLE "DomainApplication" ADD COLUMN "interviewPrepNote" TEXT;
