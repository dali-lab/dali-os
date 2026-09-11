-- CreateEnum
CREATE TYPE "ProcessType" AS ENUM ('Project', 'EducationOffering', 'HiringCycle', 'Core');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "publicWriteupPageId" TEXT;

-- CreateTable
CREATE TABLE "ProcessFolderBinding" (
    "id" TEXT NOT NULL,
    "processType" "ProcessType" NOT NULL,
    "processId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "folderPageId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessFolderBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessFolderBinding_folderPageId_idx" ON "ProcessFolderBinding"("folderPageId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessFolderBinding_processType_processId_purpose_key" ON "ProcessFolderBinding"("processType", "processId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Project_publicWriteupPageId_key" ON "Project"("publicWriteupPageId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_publicWriteupPageId_fkey" FOREIGN KEY ("publicWriteupPageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessFolderBinding" ADD CONSTRAINT "ProcessFolderBinding_folderPageId_fkey" FOREIGN KEY ("folderPageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

