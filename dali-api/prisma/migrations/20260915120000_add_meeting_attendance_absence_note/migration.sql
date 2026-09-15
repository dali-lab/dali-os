-- Optional Core-authored context for an attendance row, written from the
-- attendance log's "Not submitted" roster (e.g. "excused - travelling").
-- Additive nullable column — existing rows read as "no note".

-- AlterTable
ALTER TABLE "MeetingAttendance" ADD COLUMN "absenceNote" TEXT;
