-- Backfill DomainApplication.domainId from ChallengeVersion.domainId for any
-- pre-existing Standard-cycle rows (those created before the InternToFull
-- migration when domainId did not exist on DomainApplication). New InternToFull
-- rows are inserted with domainId already set by app code.
UPDATE "DomainApplication" da
SET "domainId" = cv."domainId"
FROM "ChallengeVersion" cv
WHERE da."challengeVersionId" = cv.id
  AND da."domainId" IS NULL
  AND cv."domainId" IS NOT NULL;

-- Tighten the column. Fails fast if any row still has NULL domainId rather
-- than silently leaving the schema mid-state.
ALTER TABLE "DomainApplication" ALTER COLUMN "domainId" SET NOT NULL;
