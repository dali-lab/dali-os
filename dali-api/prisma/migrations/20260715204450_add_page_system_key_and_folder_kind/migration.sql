-- AlterEnum
ALTER TYPE "PageKind" ADD VALUE 'Folder';

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "systemKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Page_systemKey_key" ON "Page"("systemKey");

