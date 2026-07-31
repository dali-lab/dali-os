-- CreateEnum
CREATE TYPE "SigningCadence" AS ENUM ('Once', 'PerTerm', 'PerCycle');

-- AlterTable
ALTER TABLE "SigningDocument" ADD COLUMN     "cadence" "SigningCadence" NOT NULL DEFAULT 'Once';

-- Back-compat backfill: preserve the previous kind/audience-inferred scope so
-- existing documents keep the same binding cadence they had before this column.
-- Mentorship / Mentors-audience agreements were term-scoped; hiring
-- confidentiality was cycle-scoped; everything else stays one-time (the default).
UPDATE "SigningDocument" SET "cadence" = 'PerTerm'
  WHERE "kind" = 'MentorshipAgreement' OR "audience" = 'Mentors';
UPDATE "SigningDocument" SET "cadence" = 'PerCycle'
  WHERE "kind" = 'Confidentiality' OR "gateScope" = 'HiringCycle';
