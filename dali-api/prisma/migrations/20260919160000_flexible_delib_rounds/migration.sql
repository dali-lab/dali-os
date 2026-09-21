-- Delib rounds become flexible: a cycle's phases and rounds live in an ordered
-- `timeline` (app/hiring/lib/cycle-timeline.ts), and each delibs board points at
-- its round instead of being Initial or Final.
--
-- DATA-LOSING (with backfill):
--   * "hasInitialDelibs" is dropped; every cycle's timeline is written from it
--     and "hasInterviews" first, so no cycle changes shape. (A cycle with
--     interviews but no first delib gets the first round, since someone has to
--     decide who interviews.)
--   * "DelibsSession"."type" and the "DelibsType" enum are dropped; Initial
--     boards become round "first", Final boards round "final".
--   * "phaseWeeks" (added earlier in this same change, never deployed) is
--     dropped in favour of the timeline's own weeks.

-- AlterTable
ALTER TABLE "ApplicationCycle" ADD COLUMN "timeline" JSONB;

UPDATE "ApplicationCycle" SET "timeline" = CASE
  WHEN "hasInterviews" THEN '[{"kind":"phase","key":"setup","weeks":[1,4]},{"kind":"phase","key":"team","weeks":[4,5]},{"kind":"phase","key":"review","weeks":[6,6]},{"kind":"delib","id":"first","label":"First delib","weeks":[6,6]},{"kind":"phase","key":"interviews","weeks":[7,7]},{"kind":"delib","id":"final","label":"Final delib","weeks":[8,8]},{"kind":"phase","key":"decisions","weeks":[9,9]}]'::jsonb
  WHEN "hasInitialDelibs" THEN '[{"kind":"phase","key":"setup","weeks":[1,4]},{"kind":"phase","key":"team","weeks":[4,5]},{"kind":"phase","key":"review","weeks":[6,6]},{"kind":"delib","id":"first","label":"First delib","weeks":[6,6]},{"kind":"delib","id":"final","label":"Final delib","weeks":[8,8]},{"kind":"phase","key":"decisions","weeks":[9,9]}]'::jsonb
  ELSE '[{"kind":"phase","key":"setup","weeks":[1,4]},{"kind":"phase","key":"team","weeks":[4,5]},{"kind":"phase","key":"review","weeks":[6,6]},{"kind":"delib","id":"final","label":"Final delib","weeks":[8,8]},{"kind":"phase","key":"decisions","weeks":[9,9]}]'::jsonb
END;

ALTER TABLE "ApplicationCycle" DROP COLUMN "hasInitialDelibs",
DROP COLUMN "phaseWeeks";

-- DelibsSession: key boards to their round
ALTER TABLE "DelibsSession" ADD COLUMN "roundId" TEXT;
UPDATE "DelibsSession" SET "roundId" = CASE WHEN "type" = 'Initial' THEN 'first' ELSE 'final' END;
ALTER TABLE "DelibsSession" ALTER COLUMN "roundId" SET NOT NULL;

-- DropIndex
DROP INDEX "DelibsSession_domainId_applicationCycleId_type_key";

-- AlterTable
ALTER TABLE "DelibsSession" DROP COLUMN "type";

-- DropEnum
DROP TYPE "DelibsType";

-- CreateIndex
CREATE UNIQUE INDEX "DelibsSession_domainId_applicationCycleId_roundId_key" ON "DelibsSession"("domainId", "applicationCycleId", "roundId");
