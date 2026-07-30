-- AlterEnum
ALTER TYPE "PartnerApplicationStatus" ADD VALUE 'Withdrawn';

-- AlterTable
ALTER TABLE "PartnerOrg" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartnerApplication" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decisionNote" TEXT;
