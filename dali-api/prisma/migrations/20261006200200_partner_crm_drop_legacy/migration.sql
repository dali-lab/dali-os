-- Partner CRM: retire what the CRM no longer uses.
--
-- DATA LOSS, deliberate:
--   * PartnerUser — superseded by PartnerContact + PartnerMembership on
--     2026-08-20; unread by code since; kept only for a rollback window.
--   * PartnerApplication.assignedMeeterId — the CRM has no ownership.
--   * PartnerApplication.fundingModel — replaced by the typed fundingType; any
--     free text is appended to decisionReason first so nothing is lost.

UPDATE "PartnerApplication"
SET "decisionReason" = concat_ws(E'\n\n', "decisionReason", 'Funding model: ' || btrim("fundingModel"))
WHERE nullif(btrim("fundingModel"), '') IS NOT NULL;

-- AlterTable
ALTER TABLE "PartnerApplication" DROP COLUMN "assignedMeeterId",
DROP COLUMN "fundingModel";

-- DropForeignKey
ALTER TABLE "PartnerUser" DROP CONSTRAINT "PartnerUser_partnerOrgId_fkey";

-- DropForeignKey
ALTER TABLE "PartnerUser" DROP CONSTRAINT "PartnerUser_userId_fkey";

-- DropTable
DROP TABLE "PartnerUser";
