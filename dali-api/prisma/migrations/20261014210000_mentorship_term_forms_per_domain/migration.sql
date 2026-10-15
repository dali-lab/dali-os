-- DropIndex
DROP INDEX "MentorshipTermForm_termId_role_key";

-- AlterTable
ALTER TABLE "MentorshipTermForm" ADD COLUMN     "domainId" TEXT;

-- Links were term-wide; copy each one to every domain with pairs that term.
INSERT INTO "MentorshipTermForm" ("id", "createdAt", "updatedAt", "termId", "domainId", "role", "formId")
SELECT gen_random_uuid()::text, f."createdAt", CURRENT_TIMESTAMP, f."termId", d."domainId", f."role", f."formId"
FROM "MentorshipTermForm" f
JOIN (SELECT DISTINCT "termId", "domainId" FROM "MentorshipPair") d ON d."termId" = f."termId"
WHERE f."domainId" IS NULL;

DELETE FROM "MentorshipTermForm" WHERE "domainId" IS NULL;

ALTER TABLE "MentorshipTermForm" ALTER COLUMN "domainId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "MentorshipTermForm_domainId_idx" ON "MentorshipTermForm"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "MentorshipTermForm_termId_domainId_role_key" ON "MentorshipTermForm"("termId", "domainId", "role");

-- AddForeignKey
ALTER TABLE "MentorshipTermForm" ADD CONSTRAINT "MentorshipTermForm_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
