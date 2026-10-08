-- AlterTable
ALTER TABLE "ApplicationCycle" ADD COLUMN     "continuedInterestFormId" TEXT;

-- AlterTable
ALTER TABLE "DomainApplication" ADD COLUMN     "continuedFromId" TEXT,
ADD COLUMN     "continuedInterestAnswers" JSONB,
ADD COLUMN     "continuedInterestFormVersionId" TEXT;

-- CreateIndex
CREATE INDEX "DomainApplication_continuedFromId_idx" ON "DomainApplication"("continuedFromId");

-- CreateIndex
CREATE INDEX "DomainApplication_continuedInterestFormVersionId_idx" ON "DomainApplication"("continuedInterestFormVersionId");

-- AddForeignKey
ALTER TABLE "ApplicationCycle" ADD CONSTRAINT "ApplicationCycle_continuedInterestFormId_fkey" FOREIGN KEY ("continuedInterestFormId") REFERENCES "Form"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainApplication" ADD CONSTRAINT "DomainApplication_continuedFromId_fkey" FOREIGN KEY ("continuedFromId") REFERENCES "DomainApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainApplication" ADD CONSTRAINT "DomainApplication_continuedInterestFormVersionId_fkey" FOREIGN KEY ("continuedInterestFormVersionId") REFERENCES "FormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
