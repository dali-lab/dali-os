-- Track the pre-extension closeDate so applicants can see when a cycle is in
-- an extended-deadline window. Set on first extension; cleared when the lead
-- resets the close date via the picker. Nullable, no backfill needed.
ALTER TABLE "ApplicationCycle" ADD COLUMN "originalCloseDate" TIMESTAMP(3);
