-- New assignment submission modes alongside Text/File/Mixed:
--   Link     — URL deliverable (stored in EducationSubmission.link)
--   Doc      — student-authored BlockNote collab doc (EducationSubmission.contentDocId)
--   Complete — no artifact; the student marks the task done
-- AlterEnum
ALTER TYPE "SubmissionType" ADD VALUE 'Link';
ALTER TYPE "SubmissionType" ADD VALUE 'Doc';
ALTER TYPE "SubmissionType" ADD VALUE 'Complete';

-- URL deliverable body for Link submissions.
-- AlterTable
ALTER TABLE "EducationSubmission" ADD COLUMN "link" TEXT;
