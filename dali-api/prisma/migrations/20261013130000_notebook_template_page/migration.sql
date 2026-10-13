-- Drive phase 3a: a notebook's default template (the page new notes seed from).
-- Additive only; nothing reads it until the notebook routes ship.

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "templatePageId" TEXT;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_templatePageId_fkey" FOREIGN KEY ("templatePageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
