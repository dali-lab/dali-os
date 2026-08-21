-- Retire SigningDocument.kind. It was almost entirely a display label; its one
-- load-bearing value — Confidentiality — is redundant with gateScope=HiringCycle
-- (the hiring-cycle gate, used by nothing else), which every confidentiality doc
-- already carries. The hiring gate and the member-facing "hide hiring-internal
-- agreements" filters now key off gateScope instead.
--
-- DATA-LOSING: drops the kind column + SigningDocumentKind enum. Backfill first
-- so a confidentiality doc that was somehow missing its gate keeps it (the new
-- discriminator) rather than silently becoming an ungated agreement.

-- Safety backfill: guarantee the new discriminator on any confidentiality doc.
UPDATE "SigningDocument"
  SET "gateScope" = 'HiringCycle'
  WHERE "kind" = 'Confidentiality' AND "gateScope" <> 'HiringCycle';

-- DropIndex
DROP INDEX "SigningDocument_kind_idx";

-- AlterTable
ALTER TABLE "SigningDocument" DROP COLUMN "kind";

-- DropEnum
DROP TYPE "SigningDocumentKind";
