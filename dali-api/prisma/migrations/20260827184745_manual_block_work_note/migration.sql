-- AlterTable
ALTER TABLE "ManualBlock" ADD COLUMN     "workNote" TEXT;

-- Backfill: seed the new per-block timesheet description from the existing
-- linked Block TimeEntry note (historically the block title), so already-logged
-- blocks open with a sensible, non-empty description instead of a blank one.
UPDATE "ManualBlock" mb
SET "workNote" = te."note"
FROM "TimeEntry" te
WHERE te."manualBlockId" = mb."id"
  AND mb."isWork" = true
  AND mb."workNote" IS NULL
  AND te."note" IS NOT NULL;
