-- Google Meet support: an optional video-conference link for scheduled meetings
-- and online hiring interviews. All additive + nullable — safe on populated
-- tables, no backfill. Null = no video link. See app/lib/google-calendar.ts
-- (createGoogleCalendarEvent `addMeet`) and app/hiring/lib/interview-meet.ts.

-- CreateEnum
CREATE TYPE "VideoProvider" AS ENUM ('GoogleMeet', 'Zoom', 'Manual');

-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN     "meetingUrl" TEXT,
ADD COLUMN     "videoProvider" "VideoProvider";

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "calendarEventId" TEXT,
ADD COLUMN     "videoProvider" "VideoProvider",
ADD COLUMN     "videoUrl" TEXT;
