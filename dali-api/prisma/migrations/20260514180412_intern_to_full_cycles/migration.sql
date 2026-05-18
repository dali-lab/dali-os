-- CreateEnum
CREATE TYPE "ApplicationCycleType" AS ENUM ('Standard', 'InternToFull');

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_generalChallengeVersionId_fkey";

-- DropForeignKey
ALTER TABLE "DomainApplication" DROP CONSTRAINT "DomainApplication_challengeVersionId_fkey";

-- AlterTable
ALTER TABLE "Application" ALTER COLUMN "generalChallengeVersionId" DROP NOT NULL,
ADD COLUMN     "internToFullFormVersionId" TEXT;

-- AlterTable
ALTER TABLE "ApplicationCycle" ADD COLUMN     "cycleType" "ApplicationCycleType" NOT NULL DEFAULT 'Standard',
ADD COLUMN     "internToFullFormVersionId" TEXT;

-- AlterTable
ALTER TABLE "DomainApplication" ALTER COLUMN "challengeVersionId" DROP NOT NULL,
ADD COLUMN     "domainId" TEXT;

-- CreateTable
CREATE TABLE "InternToFullFormVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "InternToFullFormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InternToFullFormVersion_version_key" ON "InternToFullFormVersion"("version");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_generalChallengeVersionId_fkey" FOREIGN KEY ("generalChallengeVersionId") REFERENCES "ChallengeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_internToFullFormVersionId_fkey" FOREIGN KEY ("internToFullFormVersionId") REFERENCES "InternToFullFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationCycle" ADD CONSTRAINT "ApplicationCycle_internToFullFormVersionId_fkey" FOREIGN KEY ("internToFullFormVersionId") REFERENCES "InternToFullFormVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainApplication" ADD CONSTRAINT "DomainApplication_challengeVersionId_fkey" FOREIGN KEY ("challengeVersionId") REFERENCES "ChallengeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainApplication" ADD CONSTRAINT "DomainApplication_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternToFullFormVersion" ADD CONSTRAINT "InternToFullFormVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
