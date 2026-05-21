-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "prdPageId" TEXT,
ADD COLUMN     "repoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ProjectTermStatus" ADD COLUMN     "gcalLink" TEXT,
ADD COLUMN     "sowPageId" TEXT,
ADD COLUMN     "zoomLink" TEXT;

-- AlterTable
ALTER TABLE "Sprint" ADD COLUMN     "epicId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_prdPageId_key" ON "Project"("prdPageId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_prdPageId_fkey" FOREIGN KEY ("prdPageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
