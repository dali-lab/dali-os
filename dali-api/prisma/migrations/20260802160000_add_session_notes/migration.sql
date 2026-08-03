-- Instructor-authored notes shown to students alongside a session (prep work,
-- what to bring, links). Nullable — existing sessions simply have none.
ALTER TABLE "EducationSession" ADD COLUMN "notes" TEXT;
