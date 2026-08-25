-- Education offerings now belong to a term (nullable FK). Going forward the
-- term is derived server-side from `startsAt` on create/update (see
-- offerings.server.ts). The backfill at the bottom does the same for existing
-- rows: an offering's term is the one whose date window contains its start
-- date; offerings that fall outside every seeded term window stay null.

-- AlterTable
ALTER TABLE "EducationOffering" ADD COLUMN     "termId" TEXT;

-- CreateIndex
CREATE INDEX "EducationOffering_termId_idx" ON "EducationOffering"("termId");

-- AddForeignKey
ALTER TABLE "EducationOffering" ADD CONSTRAINT "EducationOffering_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: map each existing offering to the term its start date falls within.
UPDATE "EducationOffering" o
SET "termId" = t."id"
FROM "Term" t
WHERE o."startsAt" >= t."startDate" AND o."startsAt" <= t."endDate";
