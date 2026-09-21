/*
  Warnings:

  - You are about to drop the column `kind` on the `ProjectChartString` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ProjectFundingType" AS ENUM ('DALI_GL', 'TRANSFER_GL', 'DALI_PTAEO', 'OTHER_PTAEO');

-- AlterTable
ALTER TABLE "ProjectChartString" DROP COLUMN "kind",
ADD COLUMN     "fundingType" "ProjectFundingType";

-- DropEnum
DROP TYPE "ChartStringKind";
