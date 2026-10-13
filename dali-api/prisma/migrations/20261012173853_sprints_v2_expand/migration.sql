-- AlterTable
ALTER TABLE "Epic" ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "sprintsBackfilledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectTerm" ADD COLUMN     "sprintAnchorDay" INTEGER;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "carryoverCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sprintId" TEXT;

-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "plannedCount" INTEGER,
    "completedCount" INTEGER,
    "carriedOverCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SprintTaskSnapshot" (
    "sprintId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "statusAtClose" "TaskStatus" NOT NULL,
    "carriedToSprintId" TEXT,

    CONSTRAINT "SprintTaskSnapshot_pkey" PRIMARY KEY ("sprintId","taskId")
);

-- CreateIndex
CREATE INDEX "Sprint_termId_idx" ON "Sprint"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "Sprint_projectId_startsOn_key" ON "Sprint"("projectId", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "Sprint_projectId_termId_number_key" ON "Sprint"("projectId", "termId", "number");

-- CreateIndex
CREATE INDEX "SprintTaskSnapshot_taskId_idx" ON "SprintTaskSnapshot"("taskId");

-- CreateIndex
CREATE INDEX "SprintTaskSnapshot_carriedToSprintId_idx" ON "SprintTaskSnapshot"("carriedToSprintId");

-- CreateIndex
CREATE INDEX "Task_sprintId_idx" ON "Task"("sprintId");

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintTaskSnapshot" ADD CONSTRAINT "SprintTaskSnapshot_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintTaskSnapshot" ADD CONSTRAINT "SprintTaskSnapshot_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintTaskSnapshot" ADD CONSTRAINT "SprintTaskSnapshot_carriedToSprintId_fkey" FOREIGN KEY ("carriedToSprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: the hand-set Cancelled status becomes the cancelledAt override.
UPDATE "Epic" SET "cancelledAt" = CURRENT_TIMESTAMP WHERE "status" = 'Cancelled' AND "cancelledAt" IS NULL;
