-- Staffing is always open: drop the open/close lifecycle. Removes
-- StaffingCycle.status / opensAt / closesAt and the StaffingStatus enum, and
-- enforces one cycle per term.
--
-- Data note: opensAt/closesAt/status are operational metadata only; no other
-- table references them.

-- Fail loudly (before any destructive change) if the one-cycle-per-term
-- invariant is already violated, rather than letting CREATE UNIQUE INDEX
-- abort mid-migration with an opaque "could not create unique index" error.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT "termId" FROM "StaffingCycle" GROUP BY "termId" HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'staffing_always_open: % term(s) have more than one StaffingCycle. Resolve duplicates before migrating (keep one cycle per term).', dup_count;
  END IF;
END $$;

-- DropColumn
ALTER TABLE "StaffingCycle" DROP COLUMN "status",
DROP COLUMN "opensAt",
DROP COLUMN "closesAt";

-- DropEnum
DROP TYPE "StaffingStatus";

-- CreateIndex
CREATE UNIQUE INDEX "StaffingCycle_termId_key" ON "StaffingCycle"("termId");
