-- CreateEnum
CREATE TYPE "PartnerReferralType" AS ENUM ('ColdLead', 'WarmLead', 'FundedPitch');

-- CreateTable
CREATE TABLE "PartnerReferral" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referrerUserId" TEXT NOT NULL,
    "type" "PartnerReferralType" NOT NULL,
    "rawName" TEXT,
    "rawEmail" TEXT,
    "rawOrg" TEXT,
    "rawPhone" TEXT,
    "rawLinkedinUrl" TEXT,
    "pitchTitle" TEXT,
    "pitchSummary" TEXT,
    "notes" TEXT,
    "partnerContactId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "PartnerReferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerReferral_referrerUserId_createdAt_idx" ON "PartnerReferral"("referrerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerReferral_resolvedAt_idx" ON "PartnerReferral"("resolvedAt");

-- CreateIndex
CREATE INDEX "PartnerReferral_partnerContactId_idx" ON "PartnerReferral"("partnerContactId");

-- AddForeignKey
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_partnerContactId_fkey" FOREIGN KEY ("partnerContactId") REFERENCES "PartnerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "PartnerApplication" ADD COLUMN "referredByUserId" TEXT,
                                   ADD COLUMN "referralId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApplication_referralId_key" ON "PartnerApplication"("referralId");

-- CreateIndex
CREATE INDEX "PartnerApplication_referredByUserId_idx" ON "PartnerApplication"("referredByUserId");

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "PartnerReferral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
