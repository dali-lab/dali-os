-- AlterTable
ALTER TABLE "DomainApplicationCycle" ADD COLUMN     "closeDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DomainApplication" ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- Backfill: every domain application on an already-submitted application
-- counts as submitted at that first submission.
UPDATE "DomainApplication" da
SET "submittedAt" = s."firstSubmittedAt"
FROM (
  SELECT "applicationId", MIN("createdAt") AS "firstSubmittedAt"
  FROM "ApplicationStatusUpdate"
  WHERE "newStatus" = 'Submitted'
  GROUP BY "applicationId"
) s
WHERE da."applicationId" = s."applicationId"
  AND da."submittedAt" IS NULL;
