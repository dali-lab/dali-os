-- Phase 3: DALI Timesheet Google mirror
-- Additive-only — all columns are nullable or have defaults. Non-data-losing.

-- TimeEntry: store the Google event id and the UserCalendarLink that hosts it,
-- so the mirror can be patched or deleted later.
ALTER TABLE "TimeEntry" ADD COLUMN "googleTimesheetEventId" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN "googleTimesheetLinkId" TEXT;

-- UserAvailabilitySettings: per-user opt-in flag + the resolved calendar coords.
ALTER TABLE "UserAvailabilitySettings" ADD COLUMN "timesheetGoogleSync" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserAvailabilitySettings" ADD COLUMN "timesheetCalendarLinkId" TEXT;
ALTER TABLE "UserAvailabilitySettings" ADD COLUMN "timesheetCalendarId" TEXT;
