-- CreateTable
CREATE TABLE "MeetingReminderLog" (
    "id" TEXT NOT NULL,
    "scheduledMeetingId" TEXT NOT NULL,
    "occurrenceStart" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingReminderLog_scheduledMeetingId_occurrenceStart_userI_key" ON "MeetingReminderLog"("scheduledMeetingId", "occurrenceStart", "userId");

-- AddForeignKey
ALTER TABLE "MeetingReminderLog" ADD CONSTRAINT "MeetingReminderLog_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

