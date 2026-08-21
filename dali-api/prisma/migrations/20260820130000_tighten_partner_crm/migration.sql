-- Account-first partner CRM — tighten step.
-- Runs after the backfill (20260820120100) has populated applicantContactId on
-- every existing row, so SET NOT NULL is safe. The FK also flips from SET NULL
-- to RESTRICT now that the column is required (a contact with applications
-- can't be silently orphaned). partnerOrgId stays nullable — it's set only at
-- promotion.

-- DropForeignKey
ALTER TABLE "PartnerApplication" DROP CONSTRAINT "PartnerApplication_applicantContactId_fkey";

-- AlterTable
ALTER TABLE "PartnerApplication" ALTER COLUMN "applicantContactId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_applicantContactId_fkey" FOREIGN KEY ("applicantContactId") REFERENCES "PartnerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
