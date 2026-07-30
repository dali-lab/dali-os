-- CreateEnum
CREATE TYPE "PartnerMeetingRequestStatus" AS ENUM ('Open', 'Scheduled', 'Declined');

-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN     "partnerVisible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PartnerUser" ADD COLUMN     "calendarFeedToken" TEXT;

-- CreateTable
CREATE TABLE "PartnerMeetingResponse" (
    "id" TEXT NOT NULL,
    "scheduledMeetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rsvp" "MeetingRsvp",
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerMeetingResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerMeetingRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "partnerOrgId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "details" TEXT,
    "preferredWindows" TEXT,
    "status" "PartnerMeetingRequestStatus" NOT NULL DEFAULT 'Open',
    "resultingMeetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerMeetingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerMeetingResponse_userId_idx" ON "PartnerMeetingResponse"("userId");

-- CreateIndex
CREATE INDEX "PartnerMeetingResponse_scheduledMeetingId_idx" ON "PartnerMeetingResponse"("scheduledMeetingId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerMeetingResponse_scheduledMeetingId_userId_key" ON "PartnerMeetingResponse"("scheduledMeetingId", "userId");

-- CreateIndex
CREATE INDEX "PartnerMeetingRequest_projectId_idx" ON "PartnerMeetingRequest"("projectId");

-- CreateIndex
CREATE INDEX "PartnerMeetingRequest_partnerOrgId_idx" ON "PartnerMeetingRequest"("partnerOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerUser_calendarFeedToken_key" ON "PartnerUser"("calendarFeedToken");
