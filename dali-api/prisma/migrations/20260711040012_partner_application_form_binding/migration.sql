/*
  Warnings:

  - A unique constraint covering the columns `[formSubmissionId]` on the table `PartnerApplication` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "PartnerApplication" ADD COLUMN     "formSubmissionId" TEXT;

-- CreateTable
CREATE TABLE "PartnerApplicationFormBinding" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerApplicationFormBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerApplicationFormBinding_formId_idx" ON "PartnerApplicationFormBinding"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApplication_formSubmissionId_key" ON "PartnerApplication"("formSubmissionId");

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplicationFormBinding" ADD CONSTRAINT "PartnerApplicationFormBinding_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
