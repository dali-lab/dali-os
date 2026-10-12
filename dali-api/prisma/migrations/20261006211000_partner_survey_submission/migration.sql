-- Post-project survey (specs/partner-crm.md §11): when the partner-survey-send
-- job emailed a ProjectPartner's org, and the FormSubmission it got back once
-- the partner filled the bound PartnerSurveyFormBinding form. Additive only.

-- AlterTable
ALTER TABLE "ProjectPartner" ADD COLUMN     "surveySentAt" TIMESTAMP(3),
ADD COLUMN     "surveySubmissionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPartner_surveySubmissionId_key" ON "ProjectPartner"("surveySubmissionId");

-- AddForeignKey
ALTER TABLE "ProjectPartner" ADD CONSTRAINT "ProjectPartner_surveySubmissionId_fkey" FOREIGN KEY ("surveySubmissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
