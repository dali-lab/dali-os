-- Consolidate the partner contract onto the shared signing engine: it becomes a
-- first-class SigningDocument (kind PartnerContract), instanced per application
-- via a SigningBinding (scopeKey "partner-app:<id>", applicationId set) and
-- signed in the partner portal through the same recordSignature/SigningSignature
-- machinery as the member/mentorship/confidentiality agreements.

-- AlterEnum
ALTER TYPE "SigningDocumentKind" ADD VALUE 'PartnerContract';

-- AlterTable
ALTER TABLE "SigningBinding" ADD COLUMN     "applicationId" TEXT;

-- AlterTable
ALTER TABLE "PartnerApplication" ADD COLUMN     "contractBindingId" TEXT;

-- CreateIndex
CREATE INDEX "SigningBinding_applicationId_idx" ON "SigningBinding"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApplication_contractBindingId_key" ON "PartnerApplication"("contractBindingId");
