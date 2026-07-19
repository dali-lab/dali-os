-- Project-team Google Workspace GROUP address (e.g.
-- "projectalpha-team@dali.dartmouth.edu"). Get-or-created by the staffing
-- "Create Gmail accounts" finalize automation, which also adds the confirmed
-- roster as group members. Null until that automation first runs. Nullable,
-- additive — no backfill, no data loss.
ALTER TABLE "Project" ADD COLUMN "teamGroupEmail" TEXT;
