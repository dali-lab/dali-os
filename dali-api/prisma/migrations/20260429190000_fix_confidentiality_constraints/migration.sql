-- Drop redundant primary key on CycleConfidentialityAgreement.
-- The schema uses @unique (not @id) for applicationCycleId; the original
-- migration created a PRIMARY KEY, but the unique index already enforces
-- uniqueness. This aligns the DB state with the Prisma schema.
ALTER TABLE "CycleConfidentialityAgreement" DROP CONSTRAINT "CycleConfidentialityAgreement_pkey";

-- Rename FK constraints to match current Prisma generator naming convention.
-- The original migration used the FK column name (confidentialityAgreementVersionId)
-- to build the constraint identifier; the current generator derives the name from
-- the relation field (confidentialityAgreementVersion), producing a different
-- 63-char truncation.
ALTER TABLE "CycleConfidentialityAgreement"
  RENAME CONSTRAINT "CycleConfidentialityAgreement_confidentialityAgreementVersionId"
  TO "CycleConfidentialityAgreement_confidentialityAgreementVers_fkey";

ALTER TABLE "ConfidentialityAgreementSignature"
  RENAME CONSTRAINT "ConfidentialityAgreementSignature_confidentialityAgreementVersi"
  TO "ConfidentialityAgreementSignature_confidentialityAgreement_fkey";
