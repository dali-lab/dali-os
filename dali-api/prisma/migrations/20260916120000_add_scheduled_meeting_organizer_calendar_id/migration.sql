-- Which calendar within the organizer's linked Google account hosts the event
-- (Google calendarId). Persisted at create so an edit can events.patch the
-- right calendar rather than defaulting to "primary".
-- Additive nullable column — existing rows read as "primary / no external event".

-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN "organizerCalendarId" TEXT;
