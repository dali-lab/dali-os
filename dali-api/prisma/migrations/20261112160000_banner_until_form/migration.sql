-- AlterTable
ALTER TABLE "Banner" ADD COLUMN     "untilFormId" TEXT;

-- CreateIndex
CREATE INDEX "Banner_untilFormId_idx" ON "Banner"("untilFormId");

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_untilFormId_fkey" FOREIGN KEY ("untilFormId") REFERENCES "Form"("id") ON DELETE SET NULL ON UPDATE CASCADE;
