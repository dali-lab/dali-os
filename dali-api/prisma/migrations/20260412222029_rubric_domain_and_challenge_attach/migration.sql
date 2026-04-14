/*
  Warnings:

  - You are about to drop the column `challengeVersionId` on the `RubricVersion` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "RubricVersion" DROP CONSTRAINT "RubricVersion_challengeVersionId_fkey";

-- AlterTable
ALTER TABLE "ChallengeVersion" ADD COLUMN     "rubricVersionId" TEXT;

-- AlterTable
ALTER TABLE "Rubric" ADD COLUMN     "domainId" TEXT;

-- AlterTable
ALTER TABLE "RubricVersion" DROP COLUMN "challengeVersionId";

-- AddForeignKey
ALTER TABLE "ChallengeVersion" ADD CONSTRAINT "ChallengeVersion_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;
