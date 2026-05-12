-- DomainLeadAssignment is not term-scoped. The prior migration was edited to
-- never add `termId` (the NOT NULL ADD COLUMN failed against populated rows
-- on staging), so the drops below are no-ops on a fresh chain. IF EXISTS
-- keeps this migration idempotent for any environment that did get the
-- column added before the chain was repaired.

ALTER TABLE "DomainLeadAssignment" DROP CONSTRAINT IF EXISTS "DomainLeadAssignment_termId_fkey";

DROP INDEX IF EXISTS "DomainLeadAssignment_memberId_domainId_termId_key";
DROP INDEX IF EXISTS "DomainLeadAssignment_domainId_termId_idx";

ALTER TABLE "DomainLeadAssignment" DROP COLUMN IF EXISTS "termId";

CREATE UNIQUE INDEX IF NOT EXISTS "DomainLeadAssignment_memberId_domainId_key"
  ON "DomainLeadAssignment"("memberId", "domainId");
CREATE INDEX IF NOT EXISTS "DomainLeadAssignment_domainId_idx"
  ON "DomainLeadAssignment"("domainId");
