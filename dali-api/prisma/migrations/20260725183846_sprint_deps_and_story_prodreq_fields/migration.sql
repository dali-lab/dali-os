-- CreateEnum
CREATE TYPE "StoryPriority" AS ENUM ('Must', 'Should', 'Could', 'Wont');

-- AlterTable
ALTER TABLE "UserStory" ADD COLUMN     "acceptanceCriteria" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "priority" "StoryPriority",
ADD COLUMN     "successMetric" TEXT;

-- CreateTable
CREATE TABLE "SprintDependency" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "dependsOnSprintId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SprintDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SprintDependency_dependsOnSprintId_idx" ON "SprintDependency"("dependsOnSprintId");

-- CreateIndex
CREATE UNIQUE INDEX "SprintDependency_sprintId_dependsOnSprintId_key" ON "SprintDependency"("sprintId", "dependsOnSprintId");

-- AddForeignKey
ALTER TABLE "SprintDependency" ADD CONSTRAINT "SprintDependency_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintDependency" ADD CONSTRAINT "SprintDependency_dependsOnSprintId_fkey" FOREIGN KEY ("dependsOnSprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
