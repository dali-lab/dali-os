-- DropForeignKey
ALTER TABLE "Sprint" DROP CONSTRAINT "Sprint_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Sprint" DROP CONSTRAINT "Sprint_epicId_fkey";

-- DropForeignKey
ALTER TABLE "SprintDependency" DROP CONSTRAINT "SprintDependency_sprintId_fkey";

-- DropForeignKey
ALTER TABLE "SprintDependency" DROP CONSTRAINT "SprintDependency_dependsOnSprintId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_sprintId_fkey";

-- DropIndex
DROP INDEX "Task_projectId_sprintId_idx";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "sprintId";

-- DropTable
DROP TABLE "Sprint";

-- DropTable
DROP TABLE "SprintDependency";

-- DropEnum
DROP TYPE "SprintStatus";

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");

