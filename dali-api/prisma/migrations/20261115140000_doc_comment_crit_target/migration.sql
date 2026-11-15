-- Crit Wall comments move onto DocComment (targetId = CritSubmission.id).
-- Single statement on purpose: Postgres can't add an enum value in the same
-- transaction as other statements that might reference it.
ALTER TYPE "DocCommentTarget" ADD VALUE 'crit';
