-- AlterTable
ALTER TABLE "ApplicationReview" ADD COLUMN "rubricVersionId" TEXT;

-- AddForeignKey
ALTER TABLE "ApplicationReview" ADD CONSTRAINT "ApplicationReview_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
