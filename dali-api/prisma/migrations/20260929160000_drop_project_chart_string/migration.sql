-- Retire the legacy per-project chart string columns.
--
-- DATA: both columns are dropped, but nothing is lost. Every value was
-- imported into ProjectChartString by 20260929135710_chart_string_legacy_backfill
-- (raw value kept verbatim), and since that release nothing reads or writes
-- these columns. Ships in its own deploy after that one, so no running
-- machine still selects them when they go.

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "chartString",
DROP COLUMN "chartStringType";
