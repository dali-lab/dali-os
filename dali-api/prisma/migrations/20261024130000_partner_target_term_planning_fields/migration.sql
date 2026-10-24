-- CreateEnum
CREATE TYPE "PartnerPlanningStatus" AS ENUM ('Continuing', 'Later', 'Maybe', 'New');

-- AlterTable
ALTER TABLE "PartnerApplicationTargetTerm"
  ADD COLUMN "planningStatus" "PartnerPlanningStatus",
  ADD COLUMN "plannerNotes" TEXT,
  ADD COLUMN "plannerTodo" TEXT;
