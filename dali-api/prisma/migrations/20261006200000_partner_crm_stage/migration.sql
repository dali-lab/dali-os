-- Partner CRM: collapse the ten-value funnel onto four board stages.
--
-- New column `stage` (PartnerStage) replaces `status` (PartnerApplicationStatus).
-- The old type is dropped outright rather than left with deprecated labels:
-- a fresh type + column swap is the only way to retire enum values in Postgres.
-- "Promoted" is no longer a stage; it is derived from resultingProjectId.
--
-- Also adds `position` (manual order inside a column, Task.position
-- convention) and `lastActivityAt` (board sort + stale sweep), both backfilled.

-- CreateEnum
CREATE TYPE "PartnerStage" AS ENUM ('New', 'Interview', 'Accepted', 'Rejected');

-- AlterTable
ALTER TABLE "PartnerApplication"
  ADD COLUMN "stage" "PartnerStage" NOT NULL DEFAULT 'New',
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill stage from the legacy status.
UPDATE "PartnerApplication" SET "stage" = (
  CASE "status"::text
    WHEN 'Meeting'     THEN 'Interview'
    WHEN 'UnderReview' THEN 'Interview'
    WHEN 'LearnMore'   THEN 'Interview'
    WHEN 'OnHold'      THEN 'Interview'
    WHEN 'Accepted'    THEN 'Accepted'
    WHEN 'Promoted'    THEN 'Accepted'
    WHEN 'Rejected'    THEN 'Rejected'
    ELSE 'New' -- Inquiry, Triaged, ApplicationSubmitted, Submitted
  END
)::"PartnerStage";

-- lastActivityAt = newest timeline row, else the row's own updatedAt.
UPDATE "PartnerApplication" pa
SET "lastActivityAt" = COALESCE(
  (SELECT max(a."createdAt") FROM "PartnerActivity" a WHERE a."applicationId" = pa."id"),
  pa."updatedAt"
);

-- Dense 0..n position per stage, most recently active first.
UPDATE "PartnerApplication" pa
SET "position" = r.rn - 1
FROM (
  SELECT "id",
         row_number() OVER (PARTITION BY "stage" ORDER BY "lastActivityAt" DESC, "createdAt" DESC) AS rn
  FROM "PartnerApplication"
) r
WHERE r."id" = pa."id";

-- DropIndex
DROP INDEX "PartnerApplication_status_idx";

-- AlterTable
ALTER TABLE "PartnerApplication" DROP COLUMN "status";

-- DropEnum
DROP TYPE "PartnerApplicationStatus";

-- CreateIndex
CREATE INDEX "PartnerApplication_stage_position_idx" ON "PartnerApplication"("stage", "position");

-- CreateIndex
CREATE INDEX "PartnerApplication_lastActivityAt_idx" ON "PartnerApplication"("lastActivityAt");
