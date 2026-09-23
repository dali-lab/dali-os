-- Lets a cycle move its hiring phases to other term weeks. Null keeps the
-- standard timeline, so existing cycles are unchanged.

-- AlterTable
ALTER TABLE "ApplicationCycle" ADD COLUMN "phaseWeeks" JSONB;
