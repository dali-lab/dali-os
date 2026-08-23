-- Account-first partner CRM — additive step.
-- New enum values are ADDed here but NOT used in this migration (the status
-- default change + remap live in the next migration) so Postgres doesn't hit
-- "unsafe use of new value" within one transaction.

-- CreateEnum
CREATE TYPE "PartnerMeetingOutcome" AS ENUM ('Advance', 'Hold', 'Reject', 'MoreInfoNeeded');

-- CreateEnum
CREATE TYPE "PartnerApplicationSource" AS ENUM ('Email', 'Form', 'Referral', 'Manual');

-- AlterEnum
ALTER TYPE "PartnerApplicationStatus" ADD VALUE 'Inquiry';
ALTER TYPE "PartnerApplicationStatus" ADD VALUE 'Triaged';
ALTER TYPE "PartnerApplicationStatus" ADD VALUE 'Meeting';
ALTER TYPE "PartnerApplicationStatus" ADD VALUE 'ApplicationSubmitted';
ALTER TYPE "PartnerApplicationStatus" ADD VALUE 'LearnMore';
ALTER TYPE "PartnerApplicationStatus" ADD VALUE 'Promoted';

-- DropForeignKey
ALTER TABLE "PartnerApplication" DROP CONSTRAINT "PartnerApplication_partnerOrgId_fkey";

-- AlterTable
ALTER TABLE "PartnerApplication" ADD COLUMN     "ambiguityRating" INTEGER,
ADD COLUMN     "applicantContactId" TEXT,
ADD COLUMN     "assignedMeeterId" TEXT,
ADD COLUMN     "decisionReason" TEXT,
ADD COLUMN     "evalRubric" JSONB,
ADD COLUMN     "fundingModel" TEXT,
ADD COLUMN     "interviewRating" INTEGER,
ADD COLUMN     "source" "PartnerApplicationSource" NOT NULL DEFAULT 'Form',
ALTER COLUMN "partnerOrgId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PartnerContact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "authProvider" "PartnerAuthProvider",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerMembership" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerMeeting" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "attendeeUserIds" TEXT[],
    "notes" TEXT,
    "debrief" TEXT,
    "outcome" "PartnerMeetingOutcome",
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerContact_email_key" ON "PartnerContact"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerContact_userId_key" ON "PartnerContact"("userId");

-- CreateIndex
CREATE INDEX "PartnerContact_email_idx" ON "PartnerContact"("email");

-- CreateIndex
CREATE INDEX "PartnerMembership_orgId_idx" ON "PartnerMembership"("orgId");

-- CreateIndex
CREATE INDEX "PartnerMembership_contactId_idx" ON "PartnerMembership"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerMembership_contactId_orgId_key" ON "PartnerMembership"("contactId", "orgId");

-- CreateIndex
CREATE INDEX "PartnerMeeting_applicationId_idx" ON "PartnerMeeting"("applicationId");

-- CreateIndex
CREATE INDEX "PartnerMeeting_scheduledAt_idx" ON "PartnerMeeting"("scheduledAt");

-- CreateIndex
CREATE INDEX "PartnerApplication_applicantContactId_idx" ON "PartnerApplication"("applicantContactId");

-- AddForeignKey
ALTER TABLE "PartnerContact" ADD CONSTRAINT "PartnerContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerMembership" ADD CONSTRAINT "PartnerMembership_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "PartnerContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerMembership" ADD CONSTRAINT "PartnerMembership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "PartnerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_applicantContactId_fkey" FOREIGN KEY ("applicantContactId") REFERENCES "PartnerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_partnerOrgId_fkey" FOREIGN KEY ("partnerOrgId") REFERENCES "PartnerOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerMeeting" ADD CONSTRAINT "PartnerMeeting_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerMeeting" ADD CONSTRAINT "PartnerMeeting_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "PartnerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
