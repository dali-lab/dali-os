-- AlterTable
ALTER TABLE "DocComment" ADD COLUMN     "versionId" TEXT;

-- CreateTable
CREATE TABLE "TaskFileLink" (
    "taskId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskFileLink_pkey" PRIMARY KEY ("taskId","fileId")
);

-- CreateIndex
CREATE INDEX "TaskFileLink_fileId_idx" ON "TaskFileLink"("fileId");

-- AddForeignKey
ALTER TABLE "TaskFileLink" ADD CONSTRAINT "TaskFileLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskFileLink" ADD CONSTRAINT "TaskFileLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProjectFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocComment" ADD CONSTRAINT "DocComment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProjectFileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
