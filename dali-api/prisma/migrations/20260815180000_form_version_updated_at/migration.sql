-- Track when a FormVersion was last edited in place. Until a version is first
-- used (a FormSubmission, or a hiring Application/DomainApplication that pins
-- it), the Forms editor may edit/delete it; `updatedAt` bumps on each edit and
-- serves as the fingerprint a filler carries from load to submit so a mid-fill
-- edit is caught. Additive + backfilled to now() for existing rows.
ALTER TABLE "FormVersion" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
