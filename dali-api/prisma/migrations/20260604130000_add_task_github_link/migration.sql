-- AlterTable
ALTER TABLE "Task" ADD COLUMN "githubRepo" TEXT;
ALTER TABLE "Task" ADD COLUMN "githubIssueNumber" INTEGER;
ALTER TABLE "Task" ADD COLUMN "githubIssueUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Task_githubRepo_githubIssueNumber_key" ON "Task"("githubRepo", "githubIssueNumber");
