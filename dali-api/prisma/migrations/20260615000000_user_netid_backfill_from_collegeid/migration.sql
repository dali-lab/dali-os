-- Consolidate the user's Dartmouth NetID onto a single column.
--
-- Historically, `User.netId` (written by CAS sign-in) and `User.collegeId`
-- (user-edited via the profile UI, labelled "College ID") were two columns
-- holding the same identifier. The profile editor wrote one; everything else
-- (payroll export, search, isCore, MentorshipPair lookups, …) read the other.
-- That caused real bugs — a member could fill in their "College ID" in the
-- profile and still appear NetID-less to the payroll export.
--
-- This migration copies collegeId → netId where netId is NULL so every user
-- ends up with the canonical column populated. The follow-up migration
-- (20260615000010_drop_user_collegeid) drops the now-redundant column.
--
-- Rules:
--   - Lowercase the value on copy (matches the CAS handler's normalization).
--   - Skip any row where the lowercased collegeId would collide with another
--     user's existing netId (unique constraint). The mismatch report below
--     surfaces those for manual cleanup BEFORE this migration runs in any
--     env where it might trip — `psql -f` the SELECT and resolve duplicates
--     by hand if anything shows up.
--   - Don't overwrite a populated netId. If both columns are set and disagree,
--     we keep netId (it's the CAS-canonical value) and rely on the mismatch
--     report to surface the disagreement.

-- ── Mismatch report (informational; doesn't gate the migration) ────────────
DO $$
DECLARE
  mismatch RECORD;
BEGIN
  FOR mismatch IN
    SELECT id, "firstName", "lastName", "netId", "collegeId"
    FROM "User"
    WHERE "netId" IS NOT NULL
      AND "collegeId" IS NOT NULL
      AND lower("collegeId") <> "netId"
  LOOP
    RAISE NOTICE 'netId/collegeId mismatch — user %, name "% %", netId=%, collegeId=%',
      mismatch.id, mismatch."firstName", mismatch."lastName",
      mismatch."netId", mismatch."collegeId";
  END LOOP;
END $$;

-- ── Collision report (informational; will be skipped by the backfill) ──────
DO $$
DECLARE
  collision RECORD;
BEGIN
  FOR collision IN
    SELECT u.id, u."firstName", u."lastName", u."collegeId",
           other.id AS other_id, other."netId" AS other_netid
    FROM "User" u
    JOIN "User" other ON other."netId" = lower(u."collegeId")
    WHERE u."netId" IS NULL
      AND u."collegeId" IS NOT NULL
      AND u.id <> other.id
  LOOP
    RAISE NOTICE
      'collegeId-to-netId collision — user % ("% %"), collegeId=% would collide with user % (netId=%)',
      collision.id, collision."firstName", collision."lastName",
      collision."collegeId", collision.other_id, collision.other_netid;
  END LOOP;
END $$;

-- ── Backfill: copy lower(collegeId) → netId where safe ─────────────────────
UPDATE "User" u
SET "netId" = lower(u."collegeId")
WHERE u."netId" IS NULL
  AND u."collegeId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "User" other
    WHERE other.id <> u.id
      AND other."netId" = lower(u."collegeId")
  );
