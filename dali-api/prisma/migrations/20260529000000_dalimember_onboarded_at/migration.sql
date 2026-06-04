-- Track first-login onboarding completion on DALIMember. Null = not yet
-- onboarded; the layout loader redirects such members to /onboarding.
ALTER TABLE "DALIMember" ADD COLUMN "onboardedAt" TIMESTAMP(3);

-- Backfill existing members so they are NOT forced through onboarding: treat
-- everyone who is already a member as having onboarded at their join time.
-- Only members created from now on (e.g. via accepted-applicant promotion)
-- start with a null onboardedAt and go through the flow.
UPDATE "DALIMember" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
