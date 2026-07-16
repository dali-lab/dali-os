-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('Team', 'Partner', 'Other');

-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('Meeting', 'Manual');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "meetingNoteId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN     "meetingType" "MeetingType",
ADD COLUMN     "meetingTypeLabel" TEXT,
ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "MeetingAttendance" (
    "id" TEXT NOT NULL,
    "scheduledMeetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT false,
    "markedByUserId" TEXT,
    "markedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "TimeEntrySource" NOT NULL,
    "scheduledMeetingId" TEXT,
    "projectId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingAttendance_userId_idx" ON "MeetingAttendance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAttendance_scheduledMeetingId_userId_key" ON "MeetingAttendance"("scheduledMeetingId", "userId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_date_idx" ON "TimeEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_scheduledMeetingId_userId_key" ON "TimeEntry"("scheduledMeetingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_meetingNoteId_key" ON "Page"("meetingNoteId");

-- AddForeignKey
ALTER TABLE "ScheduledMeeting" ADD CONSTRAINT "ScheduledMeeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_meetingNoteId_fkey" FOREIGN KEY ("meetingNoteId") REFERENCES "ScheduledMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

