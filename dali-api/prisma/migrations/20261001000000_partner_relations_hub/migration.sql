-- CreateEnum
CREATE TYPE "PartnerApplicationRejectionStage" AS ENUM ('Intake', 'Interview', 'Scoping', 'Funding', 'Other');

-- AlterTable
ALTER TABLE "PartnerApplication" ADD COLUMN     "rejectionRationale" TEXT,
ADD COLUMN     "rejectionStageAt" "PartnerApplicationRejectionStage";

-- AlterTable
ALTER TABLE "PartnerOrg" ADD COLUMN     "faviconChar" VARCHAR(8);

-- CreateTable
CREATE TABLE "PartnerRelationsTodo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,
    "partnerOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerRelationsTodo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerRelationsTodo_userId_done_createdAt_idx" ON "PartnerRelationsTodo"("userId", "done", "createdAt");

-- AddForeignKey
ALTER TABLE "PartnerRelationsTodo" ADD CONSTRAINT "PartnerRelationsTodo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerRelationsTodo" ADD CONSTRAINT "PartnerRelationsTodo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerRelationsTodo" ADD CONSTRAINT "PartnerRelationsTodo_partnerOrgId_fkey" FOREIGN KEY ("partnerOrgId") REFERENCES "PartnerOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;
