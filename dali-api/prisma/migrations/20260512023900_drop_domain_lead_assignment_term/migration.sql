-- DomainLeadAssignment is no longer term-scoped. An assignment now persists
-- across terms until manually removed.
--
-- Drop the old composite unique + term-related index, drop the FK, drop the
-- column. Add a (memberId, domainId) unique so a member can only hold one
-- assignment per domain.

ALTER TABLE "DomainLeadAssignment" DROP CONSTRAINT "DomainLeadAssignment_termId_fkey";

DROP INDEX "DomainLeadAssignment_memberId_domainId_termId_key";
DROP INDEX "DomainLeadAssignment_domainId_termId_idx";

ALTER TABLE "DomainLeadAssignment" DROP COLUMN "termId";

CREATE UNIQUE INDEX "DomainLeadAssignment_memberId_domainId_key"
  ON "DomainLeadAssignment"("memberId", "domainId");
CREATE INDEX "DomainLeadAssignment_domainId_idx"
  ON "DomainLeadAssignment"("domainId");
