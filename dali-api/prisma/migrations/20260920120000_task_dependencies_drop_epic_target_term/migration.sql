-- Task dependencies: the same directed "waits on" edge epics and stories
-- already carry, one level down. Drives the board's Blocked chip, the task
-- modal's Blocked by / Blocks lists, and task arrows on the timeline.
--
-- Retire Epic.targetTermId. An epic's terms are now derived purely from its
-- dates (and its stories' and tasks' dates), the same way a task's are.
--
-- Data loss: any epic's target term is dropped. Epics with dates keep their
-- term footprint from those dates; an undated epic that only had a target term
-- now shows under every term filter until it is given dates.

-- AlterTable
ALTER TABLE "Epic" DROP COLUMN "targetTermId";

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskDependency_dependsOnTaskId_idx" ON "TaskDependency"("dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

