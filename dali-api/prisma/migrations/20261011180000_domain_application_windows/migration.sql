-- AlterTable
ALTER TABLE "DomainApplicationCycle" ADD COLUMN     "closeDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DomainApplication" ADD COLUMN     "submittedAt" TIMESTAMP(3);
