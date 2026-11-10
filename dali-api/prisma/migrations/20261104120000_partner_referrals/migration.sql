-- CreateEnum
CREATE TYPE "PartnerReferralTier" AS ENUM ('Cold', 'Warm', 'FullPitch');

-- CreateTable
CREATE TABLE "PartnerReferral" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "referredByUserId" TEXT NOT NULL,
    "tier" "PartnerReferralTier" NOT NULL,
    "partnerName" TEXT NOT NULL,
    "partnerEmail" TEXT,
    "partnerAffiliation" TEXT,
    "partnerOrgName" TEXT,
    "context" TEXT NOT NULL,
    "pitchBody" TEXT,
    "coreNotes" TEXT,
    "reachedOutAt" TIMESTAMP(3),
    "reachedOutByUserId" TEXT,

    CONSTRAINT "PartnerReferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerReferral_createdAt_idx" ON "PartnerReferral"("createdAt");

-- CreateIndex
CREATE INDEX "PartnerReferral_referredByUserId_idx" ON "PartnerReferral"("referredByUserId");

-- CreateIndex
CREATE INDEX "PartnerReferral_tier_idx" ON "PartnerReferral"("tier");

-- AddForeignKey
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_reachedOutByUserId_fkey" FOREIGN KEY ("reachedOutByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PartnerReferralQuizPass" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PartnerReferralQuizPass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerReferralQuizPass_userId_key" ON "PartnerReferralQuizPass"("userId");

-- AddForeignKey
ALTER TABLE "PartnerReferralQuizPass" ADD CONSTRAINT "PartnerReferralQuizPass_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
