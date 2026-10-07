-- Partner CRM: account 360 fields, next-step/hold/reject fields, deal terms,
-- real-meeting link, meeting requests, invoices, survey binding, settings,
-- partners@ mail linking, and org/contact-level activity. All additive.
-- Ends with the PartnerActivity org/contact backfill (no new enum values are
-- used by the data statements, so ADD VALUE and use never share a transaction
-- in a way Postgres rejects).

-- CreateEnum
CREATE TYPE "PartnerOrgType" AS ENUM ('DartmouthDepartment', 'FacultyResearch', 'Startup', 'Nonprofit', 'Company', 'Alumni', 'Other');

-- CreateEnum
CREATE TYPE "PartnerChannel" AS ENUM ('Email', 'Phone', 'Slack', 'Other');

-- CreateEnum
CREATE TYPE "PartnerRejectReason" AS ENUM ('NotAFit', 'NoCapacity', 'Funding', 'Timing', 'Withdrawn', 'Other');

-- CreateEnum
CREATE TYPE "PartnerSowState" AS ENUM ('Draft', 'Shared', 'Accepted');

-- CreateEnum
CREATE TYPE "PartnerMeetingRequestStatus" AS ENUM ('Pending', 'Accepted', 'Declined', 'Expired');

-- CreateEnum
CREATE TYPE "PartnerInvoiceStatus" AS ENUM ('Draft', 'Issued', 'Paid', 'Void');

-- AlterEnum
ALTER TYPE "PartnerActivityType" ADD VALUE 'MeetingRequested';
ALTER TYPE "PartnerActivityType" ADD VALUE 'MeetingRequestDeclined';
ALTER TYPE "PartnerActivityType" ADD VALUE 'ContractSent';
ALTER TYPE "PartnerActivityType" ADD VALUE 'ContractSigned';
ALTER TYPE "PartnerActivityType" ADD VALUE 'InvoiceIssued';
ALTER TYPE "PartnerActivityType" ADD VALUE 'InvoicePaid';
ALTER TYPE "PartnerActivityType" ADD VALUE 'ProjectLinked';
ALTER TYPE "PartnerActivityType" ADD VALUE 'ProjectEnded';
ALTER TYPE "PartnerActivityType" ADD VALUE 'SurveyReceived';
ALTER TYPE "PartnerActivityType" ADD VALUE 'OrgUpdated';
ALTER TYPE "PartnerActivityType" ADD VALUE 'MemberAdded';
ALTER TYPE "PartnerActivityType" ADD VALUE 'MemberRemoved';

-- AlterEnum
ALTER TYPE "PartnerApplicationSource" ADD VALUE 'Renewal';

-- AlterTable
ALTER TABLE "MailMessageIndex" ADD COLUMN     "linkedPartnerContactId" TEXT;

-- AlterTable
ALTER TABLE "PartnerActivity" ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "orgId" TEXT,
ALTER COLUMN "applicationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PartnerApplication"
ADD COLUMN     "contractBindingId" TEXT,
ADD COLUMN     "feeCents" INTEGER,
ADD COLUMN     "fundingType" "ProjectFundingType",
ADD COLUMN     "holdUntil" TIMESTAMP(3),
ADD COLUMN     "legalEntityAddress" TEXT,
ADD COLUMN     "legalEntityName" TEXT,
ADD COLUMN     "meetingRequestedAt" TIMESTAMP(3),
ADD COLUMN     "nextStep" TEXT,
ADD COLUMN     "nextStepDueAt" TIMESTAMP(3),
ADD COLUMN     "paymentSchedule" TEXT,
ADD COLUMN     "rejectReason" "PartnerRejectReason",
ADD COLUMN     "sowState" "PartnerSowState" NOT NULL DEFAULT 'Draft';

-- AlterTable
ALTER TABLE "PartnerContact" ADD COLUMN     "affiliation" TEXT,
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "preferredChannel" "PartnerChannel",
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "PartnerMeeting" ADD COLUMN     "scheduledMeetingId" TEXT;

-- AlterTable
ALTER TABLE "PartnerOrg" ADD COLUMN     "address" TEXT,
ADD COLUMN     "legalEntityName" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "referredByContactId" TEXT,
ADD COLUMN     "showcaseConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "type" "PartnerOrgType";

-- CreateTable
CREATE TABLE "PartnerMeetingRequest" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "projectId" TEXT,
    "contactId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "participantUserIds" TEXT[],
    "note" TEXT,
    "status" "PartnerMeetingRequestStatus" NOT NULL DEFAULT 'Pending',
    "respondedByUserId" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "scheduledMeetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerMeetingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerInvoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "applicationId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "PartnerInvoiceStatus" NOT NULL DEFAULT 'Draft',
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSurveyFormBinding" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerSurveyFormBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCrmSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "interviewPanelUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "staleDays" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerCrmSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerMeetingRequest_scheduledMeetingId_key" ON "PartnerMeetingRequest"("scheduledMeetingId");

-- CreateIndex
CREATE INDEX "PartnerMeetingRequest_applicationId_status_idx" ON "PartnerMeetingRequest"("applicationId", "status");

-- CreateIndex
CREATE INDEX "PartnerMeetingRequest_projectId_status_idx" ON "PartnerMeetingRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "PartnerMeetingRequest_contactId_idx" ON "PartnerMeetingRequest"("contactId");

-- CreateIndex
CREATE INDEX "PartnerInvoice_orgId_idx" ON "PartnerInvoice"("orgId");

-- CreateIndex
CREATE INDEX "PartnerSurveyFormBinding_formId_idx" ON "PartnerSurveyFormBinding"("formId");

-- CreateIndex
CREATE INDEX "MailMessageIndex_linkedPartnerContactId_sentAt_idx" ON "MailMessageIndex"("linkedPartnerContactId", "sentAt");

-- CreateIndex
CREATE INDEX "PartnerActivity_orgId_createdAt_idx" ON "PartnerActivity"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerActivity_contactId_createdAt_idx" ON "PartnerActivity"("contactId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApplication_contractBindingId_key" ON "PartnerApplication"("contractBindingId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerMeeting_scheduledMeetingId_key" ON "PartnerMeeting"("scheduledMeetingId");

-- AddForeignKey
ALTER TABLE "MailMessageIndex" ADD CONSTRAINT "MailMessageIndex_linkedPartnerContactId_fkey" FOREIGN KEY ("linkedPartnerContactId") REFERENCES "PartnerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerMeetingRequest" ADD CONSTRAINT "PartnerMeetingRequest_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerMeetingRequest" ADD CONSTRAINT "PartnerMeetingRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "PartnerContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerMeetingRequest" ADD CONSTRAINT "PartnerMeetingRequest_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerInvoice" ADD CONSTRAINT "PartnerInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "PartnerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerInvoice" ADD CONSTRAINT "PartnerInvoice_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSurveyFormBinding" ADD CONSTRAINT "PartnerSurveyFormBinding_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerMeeting" ADD CONSTRAINT "PartnerMeeting_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerActivity" ADD CONSTRAINT "PartnerActivity_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "PartnerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerActivity" ADD CONSTRAINT "PartnerActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "PartnerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing activity belongs to an application; copy its org and
-- contact down so the org/contact timelines include history. Idempotent.
UPDATE "PartnerActivity" a
SET "orgId" = pa."partnerOrgId",
    "contactId" = pa."applicantContactId"
FROM "PartnerApplication" pa
WHERE pa."id" = a."applicationId"
  AND a."contactId" IS NULL;
