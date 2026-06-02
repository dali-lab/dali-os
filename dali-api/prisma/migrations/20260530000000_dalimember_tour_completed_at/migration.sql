-- Track launch-tour completion per member (server-driven, not browser
-- localStorage). Null = not yet completed → the tour is shown once after
-- onboarding. Backfill existing members to now() so they don't suddenly get
-- the tour; only members onboarding from here on will see it.
ALTER TABLE "DALIMember" ADD COLUMN "tourCompletedAt" TIMESTAMP(3);

-- Only suppress the tour for members who are ALREADY onboarded. Members still
-- mid-onboarding (onboardedAt IS NULL — e.g. freshly accepted) keep a null
-- tourCompletedAt so they get the tour after they finish onboarding.
UPDATE "DALIMember"
  SET "tourCompletedAt" = "createdAt"
  WHERE "tourCompletedAt" IS NULL AND "onboardedAt" IS NOT NULL;
