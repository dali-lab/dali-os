-- CreateEnum
CREATE TYPE "TimeProposalStatus" AS ENUM ('Pending', 'Accepted', 'Declined');

-- CreateTable
CREATE TABLE "MeetingTimeProposal" (
    "id" TEXT NOT NULL,
    "scheduledMeetingId" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "proposedStart" TIMESTAMP(3) NOT NULL,
    "status" "TimeProposalStatus" NOT NULL DEFAULT 'Pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingTimeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingTimeProposal_scheduledMeetingId_status_idx" ON "MeetingTimeProposal"("scheduledMeetingId", "status");

-- AddForeignKey
ALTER TABLE "MeetingTimeProposal" ADD CONSTRAINT "MeetingTimeProposal_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingTimeProposal" ADD CONSTRAINT "MeetingTimeProposal_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
