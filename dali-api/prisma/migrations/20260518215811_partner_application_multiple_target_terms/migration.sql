-- PartnerApplication.targetTermId (single optional term) becomes a
-- many-to-many via PartnerApplicationTargetTerm so an application can target
-- several terms (e.g. a 3-term engagement). Order matters: create + backfill
-- the join table BEFORE dropping the old column, so no data is lost.

-- CreateTable
CREATE TABLE "PartnerApplicationTargetTerm" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerApplicationTargetTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerApplicationTargetTerm_termId_idx" ON "PartnerApplicationTargetTerm"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApplicationTargetTerm_applicationId_termId_key" ON "PartnerApplicationTargetTerm"("applicationId", "termId");

-- AddForeignKey
ALTER TABLE "PartnerApplicationTargetTerm" ADD CONSTRAINT "PartnerApplicationTargetTerm_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplicationTargetTerm" ADD CONSTRAINT "PartnerApplicationTargetTerm_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing application with a target term gets one join row.
-- gen_random_uuid() supplies the id (pgcrypto is available on Postgres 13+).
INSERT INTO "PartnerApplicationTargetTerm" ("id", "applicationId", "termId", "createdAt")
SELECT gen_random_uuid()::text, "id", "targetTermId", CURRENT_TIMESTAMP
FROM "PartnerApplication"
WHERE "targetTermId" IS NOT NULL;

-- Now the old column is fully migrated and safe to drop.
-- DropForeignKey
ALTER TABLE "PartnerApplication" DROP CONSTRAINT "PartnerApplication_targetTermId_fkey";

-- DropIndex
DROP INDEX "PartnerApplication_targetTermId_idx";

-- AlterTable
ALTER TABLE "PartnerApplication" DROP COLUMN "targetTermId";
