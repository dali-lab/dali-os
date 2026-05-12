-- Set the `StaffingAssignment.status` default to 'Proposed'. This has to
-- happen in a separate migration because 'Proposed' was added to the
-- AssignmentStatus enum in the previous migration and Postgres requires
-- new enum values to be committed before they can be referenced in DDL.
ALTER TABLE "StaffingAssignment" ALTER COLUMN "status" SET DEFAULT 'Proposed';
