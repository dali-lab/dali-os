-- Resumable interactive guide: track which steps a member has cleared (by id)
-- and when they first started. Additive and backwards-compatible — existing
-- members get an empty array and a null start, which reads as "not started".
ALTER TABLE "DALIMember"
  ADD COLUMN "guideStepIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "guideStartedAt" TIMESTAMP(3);

-- Members who already finished the old launch tour keep that state: mark them
-- started so the Help page shows "Completed" rather than inviting them to
-- start over. Their step list stays empty on purpose — the new guide has steps
-- the old one never had, so "finished the old tour" is not "finished this one".
UPDATE "DALIMember"
  SET "guideStartedAt" = "tourCompletedAt"
  WHERE "tourCompletedAt" IS NOT NULL;
