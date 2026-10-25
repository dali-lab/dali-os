-- AlterTable
ALTER TABLE "PartnerCrmSettings" ADD COLUMN "plannerHiddenDomainIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
