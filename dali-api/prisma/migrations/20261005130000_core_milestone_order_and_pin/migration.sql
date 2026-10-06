-- Core milestones: drag-to-reorder within a week, and pinning. Additive, with
-- defaults, so existing rows keep their creation order and start unpinned.

-- AlterTable
ALTER TABLE "CoreMilestone" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
