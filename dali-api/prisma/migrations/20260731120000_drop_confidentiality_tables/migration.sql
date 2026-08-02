-- ─────────────────────────────────────────────────────────────────────────────
-- Contract half of the expand/contract migration onto the document-signing
-- service. The earlier 20260730140000_add_document_signing migration backfilled
-- all confidentiality data into the SigningDocument/Version/Binding/Signature
-- tables and the app + seed were repointed to read/write them, so these four
-- tables are now unused. DATA-LOSING: this permanently drops them. It runs
-- after the expand migration, so the data already lives in the new tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- DropForeignKey
ALTER TABLE "ConfidentialityAgreementVersion" DROP CONSTRAINT "ConfidentialityAgreementVersion_agreementId_fkey";

-- DropForeignKey
ALTER TABLE "ConfidentialityAgreementVersion" DROP CONSTRAINT "ConfidentialityAgreementVersion_createdById_fkey";

-- DropForeignKey
ALTER TABLE "CycleConfidentialityAgreement" DROP CONSTRAINT "CycleConfidentialityAgreement_applicationCycleId_fkey";

-- DropForeignKey
ALTER TABLE "CycleConfidentialityAgreement" DROP CONSTRAINT "CycleConfidentialityAgreement_confidentialityAgreementVers_fkey";

-- DropForeignKey
ALTER TABLE "ConfidentialityAgreementSignature" DROP CONSTRAINT "ConfidentialityAgreementSignature_userId_fkey";

-- DropForeignKey
ALTER TABLE "ConfidentialityAgreementSignature" DROP CONSTRAINT "ConfidentialityAgreementSignature_applicationCycleId_fkey";

-- DropForeignKey
ALTER TABLE "ConfidentialityAgreementSignature" DROP CONSTRAINT "ConfidentialityAgreementSignature_confidentialityAgreement_fkey";

-- DropTable
DROP TABLE "ConfidentialityAgreement";

-- DropTable
DROP TABLE "ConfidentialityAgreementVersion";

-- DropTable
DROP TABLE "CycleConfidentialityAgreement";

-- DropTable
DROP TABLE "ConfidentialityAgreementSignature";

