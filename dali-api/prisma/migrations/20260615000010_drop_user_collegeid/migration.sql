-- Drop the now-redundant collegeId column.
--
-- The preceding migration (20260615000000_user_netid_backfill_from_collegeid)
-- copied lower(collegeId) → netId for every user with a NULL netId. Profile
-- UI is updated in the same release to write netId directly. Nothing should
-- read collegeId after this PR ships; dropping it removes the divergent
-- second source of truth.

ALTER TABLE "User" DROP COLUMN "collegeId";
