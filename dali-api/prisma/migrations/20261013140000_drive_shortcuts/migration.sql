-- Drive phase 4a: shortcuts. Additive only. The partial unique index lives in
-- the next migration because it names the new enum value, which Postgres will
-- not let a statement use inside the transaction that added it.

-- AlterEnum
ALTER TYPE "PageKind" ADD VALUE 'Shortcut';

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "grantShareId" TEXT,
ADD COLUMN     "targetPageId" TEXT;

-- CreateIndex
CREATE INDEX "Page_targetPageId_idx" ON "Page"("targetPageId");

-- CreateIndex
CREATE INDEX "Page_grantShareId_idx" ON "Page"("grantShareId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_targetPageId_fkey" FOREIGN KEY ("targetPageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_grantShareId_fkey" FOREIGN KEY ("grantShareId") REFERENCES "PageShare"("id") ON DELETE SET NULL ON UPDATE CASCADE;
