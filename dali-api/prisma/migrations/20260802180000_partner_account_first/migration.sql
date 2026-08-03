-- Account-first partner applications: an application now belongs to the person
-- who applied (applicantUserId → User) rather than an organization.
-- PartnerApplication.partnerOrgId becomes nullable — the PartnerOrg is created
-- only at project promotion. Adds Core review fields (evaluation, accept
-- checklist), legal-entity capture (copied onto the org at promotion), and a
-- dated review-notes table.

-- DropForeignKey
ALTER TABLE "PartnerApplication" DROP CONSTRAINT "PartnerApplication_partnerOrgId_fkey";

-- AlterTable
ALTER TABLE "PartnerOrg" ADD COLUMN     "legalAddress" TEXT,
ADD COLUMN     "legalName" TEXT;

-- AlterTable
ALTER TABLE "PartnerApplication" ADD COLUMN     "acceptChecklist" JSONB,
ADD COLUMN     "applicantUserId" TEXT,
ADD COLUMN     "evaluation" JSONB,
ADD COLUMN     "legalEntityAddress" TEXT,
ADD COLUMN     "legalEntityName" TEXT,
ALTER COLUMN "partnerOrgId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PartnerApplicationNote" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerApplicationNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerApplicationNote_applicationId_idx" ON "PartnerApplicationNote"("applicationId");

-- CreateIndex
CREATE INDEX "PartnerApplication_applicantUserId_idx" ON "PartnerApplication"("applicantUserId");

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_partnerOrgId_fkey" FOREIGN KEY ("partnerOrgId") REFERENCES "PartnerOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplicationNote" ADD CONSTRAINT "PartnerApplicationNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: point legacy org-first applications at their org's designated
-- primary contact so historical rows have an applicant where derivable.
-- Idempotent — only fills rows that don't already have one.
UPDATE "PartnerApplication" pa
SET "applicantUserId" = pu."userId"
FROM "PartnerOrg" po
JOIN "PartnerUser" pu ON pu."id" = po."primaryContactId"
WHERE pa."partnerOrgId" = po."id"
  AND pa."applicantUserId" IS NULL
  AND po."primaryContactId" IS NOT NULL;
