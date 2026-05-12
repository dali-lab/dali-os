-- Calendar / scheduling tables that survived the expansion-v0 rollback.
-- The original v0 migration (20260511000000) bundled these together with ~30
-- other tables; rolling back v0 atomically while keeping the calendar surface
-- required moving its DDL into this dedicated migration.

-- CreateEnum
CREATE TYPE "CalProvider" AS ENUM ('Google', 'Outlook');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('Project', 'Group', 'UserList', 'Series', 'None');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('Searching', 'Confirmed', 'Cancelled');

-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('Static', 'Dynamic');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT;

-- AlterTable: pre-existing DomainLeadAssignment gets a (memberId, domainId)
-- unique constraint and a domainId index. Previously added by
-- 20260512023900_drop_domain_lead_assignment_term; that migration is now a
-- no-op so the indexes need to land here.
CREATE UNIQUE INDEX "DomainLeadAssignment_memberId_domainId_key"
  ON "DomainLeadAssignment"("memberId", "domainId");
CREATE INDEX "DomainLeadAssignment_domainId_idx" ON "DomainLeadAssignment"("domainId");

-- CreateTable
CREATE TABLE "UserCalendarLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "CalProvider" NOT NULL,
    "externalEmail" TEXT NOT NULL,
    "oauthTokens" TEXT NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT true,
    "subCalendarIds" TEXT[],
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCalendarLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledMeeting" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionDocId" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT,
    "participantUserIds" TEXT[],
    "selectedAt" TIMESTAMP(3),
    "externalEventId" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'Searching',
    "recurrenceRule" TEXT,
    "ownerCalendarEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GroupType" NOT NULL,
    "dynamicQuery" TEXT,
    "staticMemberIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingException" (
    "id" TEXT NOT NULL,
    "scheduledMeetingId" TEXT NOT NULL,
    "originalStart" TIMESTAMP(3) NOT NULL,
    "overrideStart" TIMESTAMP(3),
    "overrideDurationMin" INTEGER,
    "overrideTitle" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MeetingException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCalendarLink_userId_key" ON "UserCalendarLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingException_scheduledMeetingId_originalStart_key" ON "MeetingException"("scheduledMeetingId", "originalStart");

-- AddForeignKey
ALTER TABLE "UserCalendarLink" ADD CONSTRAINT "UserCalendarLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMeeting" ADD CONSTRAINT "ScheduledMeeting_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingException" ADD CONSTRAINT "MeetingException_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
