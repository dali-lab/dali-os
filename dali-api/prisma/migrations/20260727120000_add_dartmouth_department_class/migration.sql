-- AlterTable
-- Cache the raw People-API department_class so membership-status can tell an
-- enrolled grad/professional student (program code: TH/GR/DM/TU…) from a
-- graduated undergrad (class year). Additive + nullable — safe, no backfill.
ALTER TABLE "User" ADD COLUMN "dartmouthDepartmentClass" TEXT;
