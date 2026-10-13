-- AlterTable
ALTER TABLE "MentorNote" ADD COLUMN     "pageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MentorNote_pageId_key" ON "MentorNote"("pageId");

-- AddForeignKey
ALTER TABLE "MentorNote" ADD CONSTRAINT "MentorNote_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
