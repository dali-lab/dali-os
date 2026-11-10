-- Reshape CoreMilestone from a per-season playbook into a per-term plan of
-- milestones and plan items. CoreMilestone, CoreMilestoneOwner and
-- CoreMilestoneDomain are empty in every environment, so the required termId
-- column can be added without a backfill. If a row ever exists this fails
-- loudly rather than guessing a term.

-- CreateEnum
CREATE TYPE "CoreMilestoneKind" AS ENUM ('Milestone', 'Plan');

-- DropTable
DROP TABLE "CoreMilestoneDomain";

-- DropIndex
DROP INDEX "CoreMilestone_season_week_idx";

-- AlterTable
ALTER TABLE "CoreMilestone" DROP COLUMN "season",
DROP COLUMN "pinned",
ADD COLUMN "termId" TEXT NOT NULL,
ADD COLUMN "kind" "CoreMilestoneKind" NOT NULL DEFAULT 'Milestone';

ALTER TABLE "CoreMilestone" RENAME COLUMN "detail" TO "notes";

-- CreateIndex
CREATE INDEX "CoreMilestone_termId_week_kind_idx" ON "CoreMilestone"("termId", "week", "kind");

-- AddForeignKey
ALTER TABLE "CoreMilestone" ADD CONSTRAINT "CoreMilestone_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Week 0 is the lead-up before the term; 1-10 are term weeks.
ALTER TABLE "CoreMilestone" ADD CONSTRAINT "CoreMilestone_week_range" CHECK ("week" BETWEEN 0 AND 10);
