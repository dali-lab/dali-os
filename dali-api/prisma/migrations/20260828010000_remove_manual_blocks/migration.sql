-- Phase 2/4: remove in-app ManualBlock ("DALI blocks").
--
-- DATA-LOSING: drops the ManualBlock table and the TimeEntry -> ManualBlock link.
-- Block-sourced timesheet rows are first converted to standalone Manual rows so
-- no paid hours are lost (hours / role / time range preserved). The 26 existing
-- non-work blocks (all one-off, all past-dated in prod) are dropped with the
-- table — they no longer affect availability.

-- 1. Convert Block-sourced time entries into standalone Manual entries.
UPDATE "TimeEntry" SET "source" = 'Manual', "manualBlockId" = NULL WHERE "source" = 'Block';

-- 2. Drop the TimeEntry -> ManualBlock link (FK, unique index, column) before
--    dropping the table so the FK doesn't block it.
ALTER TABLE "TimeEntry" DROP CONSTRAINT IF EXISTS "TimeEntry_manualBlockId_fkey";
DROP INDEX IF EXISTS "TimeEntry_manualBlockId_userId_key";
ALTER TABLE "TimeEntry" DROP COLUMN "manualBlockId";

-- 3. Drop the ManualBlock table (its FK to User is dropped with it).
DROP TABLE "ManualBlock";

-- 4. Remove the now-unused 'Block' value from the TimeEntrySource enum. Postgres
--    can't DROP a value in place, so recreate the type without it. Safe because
--    step 1 already converted every 'Block' row to 'Manual'.
ALTER TYPE "TimeEntrySource" RENAME TO "TimeEntrySource_old";
CREATE TYPE "TimeEntrySource" AS ENUM ('Meeting', 'Manual');
ALTER TABLE "TimeEntry" ALTER COLUMN "source" TYPE "TimeEntrySource" USING ("source"::text::"TimeEntrySource");
DROP TYPE "TimeEntrySource_old";
