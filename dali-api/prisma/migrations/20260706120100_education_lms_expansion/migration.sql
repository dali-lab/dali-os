-- AlterTable
ALTER TABLE "EducationApplication" ADD COLUMN     "formSubmissionId" TEXT,
ADD COLUMN     "waitlistRank" INTEGER;

-- AlterTable
ALTER TABLE "EducationOffering" ADD COLUMN     "applicationFormId" TEXT,
ADD COLUMN     "closedOutAt" TIMESTAMP(3),
ADD COLUMN     "closedOutById" TEXT;

-- AlterTable
ALTER TABLE "EducationSession" ADD COLUMN     "feedbackRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EducationSubmission" ADD COLUMN     "feedbackText" TEXT,
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "textContent" TEXT;

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN     "educationOfferingId" TEXT,
ADD COLUMN     "educationSessionId" TEXT;

-- CreateTable
CREATE TABLE "EducationDecisionEmail" (
    "offeringId" TEXT NOT NULL,
    "status" "EduApplicationStatus" NOT NULL,
    "emailTemplateVersionId" TEXT NOT NULL,

    CONSTRAINT "EducationDecisionEmail_pkey" PRIMARY KEY ("offeringId","status")
);

-- CreateTable
CREATE TABLE "EducationDiscussionPost" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EducationDiscussionPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationStudentNote" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "feedback" TEXT,
    "feedbackUpdatedAt" TIMESTAMP(3),
    "feedbackAuthorId" TEXT,
    "internalNote" TEXT,
    "internalNoteUpdatedAt" TIMESTAMP(3),
    "internalNoteAuthorId" TEXT,

    CONSTRAINT "EducationStudentNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CECredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "sessionId" TEXT,
    "grantedById" TEXT,
    "reason" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CECredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationCertificate" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,

    CONSTRAINT "EducationCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationFormBinding" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "EducationFormBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EducationDiscussionPost_offeringId_createdAt_idx" ON "EducationDiscussionPost"("offeringId", "createdAt");

-- CreateIndex
CREATE INDEX "EducationDiscussionPost_parentId_idx" ON "EducationDiscussionPost"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "EducationStudentNote_applicationId_key" ON "EducationStudentNote"("applicationId");

-- CreateIndex
CREATE INDEX "CECredit_termId_idx" ON "CECredit"("termId");

-- CreateIndex
CREATE INDEX "CECredit_userId_termId_idx" ON "CECredit"("userId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "CECredit_userId_sessionId_key" ON "CECredit"("userId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "EducationCertificate_applicationId_key" ON "EducationCertificate"("applicationId");

-- CreateIndex
CREATE INDEX "EducationFormBinding_formId_idx" ON "EducationFormBinding"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "EducationFormBinding_offeringId_slot_key" ON "EducationFormBinding"("offeringId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "EducationApplication_formSubmissionId_key" ON "EducationApplication"("formSubmissionId");

-- CreateIndex
CREATE INDEX "FormSubmission_educationOfferingId_slot_idx" ON "FormSubmission"("educationOfferingId", "slot");

-- AddForeignKey
ALTER TABLE "EducationOffering" ADD CONSTRAINT "EducationOffering_applicationFormId_fkey" FOREIGN KEY ("applicationFormId") REFERENCES "Form"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationOffering" ADD CONSTRAINT "EducationOffering_closedOutById_fkey" FOREIGN KEY ("closedOutById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationApplication" ADD CONSTRAINT "EducationApplication_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationDecisionEmail" ADD CONSTRAINT "EducationDecisionEmail_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationDecisionEmail" ADD CONSTRAINT "EducationDecisionEmail_emailTemplateVersionId_fkey" FOREIGN KEY ("emailTemplateVersionId") REFERENCES "EmailTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationDiscussionPost" ADD CONSTRAINT "EducationDiscussionPost_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationDiscussionPost" ADD CONSTRAINT "EducationDiscussionPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationDiscussionPost" ADD CONSTRAINT "EducationDiscussionPost_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "EducationDiscussionPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationStudentNote" ADD CONSTRAINT "EducationStudentNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "EducationApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationStudentNote" ADD CONSTRAINT "EducationStudentNote_feedbackAuthorId_fkey" FOREIGN KEY ("feedbackAuthorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationStudentNote" ADD CONSTRAINT "EducationStudentNote_internalNoteAuthorId_fkey" FOREIGN KEY ("internalNoteAuthorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CECredit" ADD CONSTRAINT "CECredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CECredit" ADD CONSTRAINT "CECredit_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CECredit" ADD CONSTRAINT "CECredit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EducationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CECredit" ADD CONSTRAINT "CECredit_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationCertificate" ADD CONSTRAINT "EducationCertificate_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "EducationApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationCertificate" ADD CONSTRAINT "EducationCertificate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationFormBinding" ADD CONSTRAINT "EducationFormBinding_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationFormBinding" ADD CONSTRAINT "EducationFormBinding_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationFormBinding" ADD CONSTRAINT "EducationFormBinding_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_educationOfferingId_fkey" FOREIGN KEY ("educationOfferingId") REFERENCES "EducationOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_educationSessionId_fkey" FOREIGN KEY ("educationSessionId") REFERENCES "EducationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
