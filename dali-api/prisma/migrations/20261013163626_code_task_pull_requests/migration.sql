-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "isCodeTask" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TaskPullRequest" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "state" TEXT NOT NULL,
    "mergedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskPullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskPullRequest_repo_number_idx" ON "TaskPullRequest"("repo", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPullRequest_taskId_repo_number_key" ON "TaskPullRequest"("taskId", "repo", "number");

-- AddForeignKey
ALTER TABLE "TaskPullRequest" ADD CONSTRAINT "TaskPullRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
