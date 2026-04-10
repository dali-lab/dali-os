-- AlterTable
ALTER TABLE "ApplicationCycle" ADD COLUMN     "formVersionId" TEXT;

-- AddForeignKey
ALTER TABLE "ApplicationCycle" ADD CONSTRAINT "ApplicationCycle_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "ApplicationFormVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
