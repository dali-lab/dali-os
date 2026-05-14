-- CreateEnum
CREATE TYPE "MeetingRsvp" AS ENUM ('Accepted', 'Declined', 'Tentative');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "rsvp" "MeetingRsvp",
ADD COLUMN     "rsvpAt" TIMESTAMP(3),
ADD COLUMN     "scheduledMeetingId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN     "organizerCalendarLinkId" TEXT;

-- AddForeignKey
ALTER TABLE "ScheduledMeeting" ADD CONSTRAINT "ScheduledMeeting_organizerCalendarLinkId_fkey" FOREIGN KEY ("organizerCalendarLinkId") REFERENCES "UserCalendarLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
