-- Behavioral test for v0 Phase 2 on staging.
--
-- Goes beyond verify-v0-phase2.sql (which only checks schema + counts) by
-- actually running the queries the app does and validating writes work.
-- All writes happen inside a single transaction with ROLLBACK at the end
-- so nothing persists.
--
-- Usage:
--   flyctl proxy 5432:5432 -a dali-api-staging &
--   psql "$URL" -f scripts/test-v0-phase2.sql
--
-- Look for the PASS/FAIL labels at the start of each section's last line.

\set ON_ERROR_STOP off

BEGIN;

-- ─── 1. Reviewer dashboard query (app/hiring/routes/reviewer.tsx loader) ────
\echo ''
\echo '=== T1: reviewer dashboard — find a reviewer''s assigned reviews via new FK shape ==='
SELECT
  cr.id AS cycle_reviewer_id,
  u."firstName" || ' ' || u."lastName" AS reviewer_name,
  d."displayName" AS domain,
  COUNT(ar.id) AS reviews_in_queue
FROM "CycleReviewer" cr
JOIN "User" u ON u.id = cr."userId"
JOIN "Domain" d ON d.id = cr."domainId"
LEFT JOIN "ApplicationReview" ar ON ar."cycleReviewerId" = cr.id
GROUP BY cr.id, u."firstName", u."lastName", d."displayName"
HAVING COUNT(ar.id) > 0
ORDER BY reviews_in_queue DESC
LIMIT 5;
-- PASS: 5 rows with non-zero reviews_in_queue (reviewer has assigned work).

-- ─── 2. Domain Lead view query (app/hiring/routes/domain-lead.tsx loader) ───
\echo ''
\echo '=== T2: domain lead view — find a lead''s assigned domains ==='
SELECT
  u."firstName" || ' ' || u."lastName" AS name,
  array_agg(d."displayName" ORDER BY d."displayName") AS lead_for
FROM "DomainLeadAssignment" dla
JOIN "User" u ON u.id = dla."userId"
JOIN "Domain" d ON d.id = dla."domainId"
GROUP BY u.id, u."firstName", u."lastName"
ORDER BY array_length(array_agg(d."displayName"), 1) DESC
LIMIT 5;
-- PASS: each row has at least one domain in lead_for.

-- ─── 3. Confidentiality signature check (collabAuth.ts pattern) ─────────────
\echo ''
\echo '=== T3: a reviewer''s confidentiality state for the active cycle ==='
WITH active_cycle AS (
  SELECT id FROM "ApplicationCycle"
  WHERE id IN (SELECT "applicationCycleId" FROM "ApplicationCycleStatusUpdate" WHERE "newStatus" IN ('Open','UnderReview') ORDER BY "createdAt" DESC LIMIT 1)
)
SELECT
  cr.id AS cycle_reviewer_id,
  u."firstName" || ' ' || u."lastName" AS name,
  cas."signedAt" IS NOT NULL AS has_signed
FROM "CycleReviewer" cr
JOIN "User" u ON u.id = cr."userId"
JOIN active_cycle ac ON cr."applicationCycleId" = ac.id
LEFT JOIN "ConfidentialityAgreementSignature" cas
  ON cas."userId" = u.id AND cas."applicationCycleId" = ac.id
LIMIT 5;
-- PASS: rows return; signed status varies but the join works (User-level
-- confidentiality signature lookup still works post-rename).

-- ─── 4. Role resolution query (lib/roles.ts:getUserRoles) ───────────────────
\echo ''
\echo '=== T4: getUserRoles output for known admins ==='
SELECT
  u."daliEmail",
  EXISTS(SELECT 1 FROM "AdminMembership" am WHERE am."userId" = u.id) AS is_admin,
  EXISTS(SELECT 1 FROM "CoreAssignment" ca WHERE ca."userId" = u.id) AS is_core,
  EXISTS(SELECT 1 FROM "DomainLeadAssignment" dla WHERE dla."userId" = u.id) AS is_domain_lead,
  EXISTS(SELECT 1 FROM "DALIMember" m WHERE m."userId" = u.id) AS is_lab_member
FROM "User" u
WHERE u."daliEmail" IN (
  'kiran.jones@dali.dartmouth.edu',
  'tim@dali.dartmouth.edu',
  'madison@dali.dartmouth.edu',
  'jordan.taylor@dali.dartmouth.edu',
  'ashna.ghanate@dali.dartmouth.edu'
)
ORDER BY u."daliEmail";
-- PASS: known admins return is_admin=true; the rest match expected role shape.

-- ─── 5. Gmail integration lookup (lib/gmail-integration.ts) ─────────────────
\echo ''
\echo '=== T5: applications@dali.dartmouth.edu Gmail integration is wired up ==='
SELECT
  g."sendAsEmail",
  u."daliEmail",
  g."enabled",
  LENGTH(g."oauthTokens") > 10 AS has_token
FROM "GmailIntegration" g
JOIN "User" u ON u.id = g."userId"
WHERE g."sendAsEmail" = 'applications@dali.dartmouth.edu';
-- PASS: 1 row, enabled=true, has_token=true.

-- ─── 6. WRITE TEST: insert a fake review through the new FK shape ───────────
\echo ''
\echo '=== T6: insert a test ApplicationReview via User-based FK + rollback ==='
DO $$
DECLARE
  test_reviewer_user_id text;
  test_cr_id text;
  test_da_id text;
  test_ar_id text;
BEGIN
  -- Pick the first CycleReviewer + a DomainApplication in their domain
  SELECT cr."userId", cr.id INTO test_reviewer_user_id, test_cr_id
  FROM "CycleReviewer" cr
  LIMIT 1;

  SELECT da.id INTO test_da_id
  FROM "DomainApplication" da
  JOIN "ChallengeVersion" cv ON cv.id = da."challengeVersionId"
  JOIN "CycleReviewer" cr ON cr."domainId" = cv."domainId"
  WHERE cr.id = test_cr_id AND da.selected = TRUE
  LIMIT 1;

  IF test_reviewer_user_id IS NULL OR test_da_id IS NULL THEN
    RAISE NOTICE '  SKIP: no reviewer+app pair found';
    RETURN;
  END IF;

  -- Insert a probe review. submittedById references User now.
  INSERT INTO "ApplicationReview" (id, "cycleReviewerId", "domainApplicationId", "submittedById", "submittedAt", scores, feedback)
  VALUES (gen_random_uuid()::text, test_cr_id, test_da_id, test_reviewer_user_id, NOW(), '{}'::jsonb, 'TEST — rolled back')
  ON CONFLICT ("cycleReviewerId", "domainApplicationId") DO UPDATE
    SET feedback = 'TEST — rolled back'
  RETURNING id INTO test_ar_id;

  RAISE NOTICE '  PASS: inserted review id=% with submittedById=%', test_ar_id, test_reviewer_user_id;
END $$;

-- ─── 7. WRITE TEST: insert a Decision via User-based madeById ───────────────
\echo ''
\echo '=== T7: insert a test Decision via User-based madeById + rollback ==='
DO $$
DECLARE
  test_admin_user_id text;
  test_da_id text;
  test_dec_id text;
BEGIN
  SELECT am."userId" INTO test_admin_user_id
  FROM "AdminMembership" am LIMIT 1;

  SELECT id INTO test_da_id FROM "DomainApplication" WHERE selected = TRUE LIMIT 1;

  IF test_admin_user_id IS NULL OR test_da_id IS NULL THEN
    RAISE NOTICE '  SKIP: no admin+da pair found';
    RETURN;
  END IF;

  INSERT INTO "Decision" (id, "domainApplicationId", type, stage, "madeById", notes)
  VALUES (gen_random_uuid()::text, test_da_id, 'Rejected', 'Draft', test_admin_user_id, 'TEST — rolled back')
  RETURNING id INTO test_dec_id;

  RAISE NOTICE '  PASS: inserted decision id=% with madeById=%', test_dec_id, test_admin_user_id;
END $$;

-- ─── 8. CONSTRAINT TEST: NOT NULL on hiring FKs is enforced ────────────────
\echo ''
\echo '=== T8: constraint test — INSERT with NULL userId should fail ==='
DO $$
BEGIN
  BEGIN
    INSERT INTO "CycleReviewer" (id, "applicationCycleId", "domainId", "userId")
    VALUES (
      gen_random_uuid()::text,
      (SELECT "applicationCycleId" FROM "CycleReviewer" LIMIT 1),
      (SELECT "domainId" FROM "CycleReviewer" LIMIT 1),
      NULL
    );
    RAISE NOTICE '  FAIL: NULL userId was accepted (constraint missing)';
  EXCEPTION WHEN not_null_violation THEN
    RAISE NOTICE '  PASS: NULL userId rejected as expected';
  END;
END $$;

-- ─── 9. CONSTRAINT TEST: FK to User is enforced ─────────────────────────────
\echo ''
\echo '=== T9: constraint test — INSERT with non-existent userId should fail ==='
DO $$
BEGIN
  BEGIN
    INSERT INTO "CycleReviewer" (id, "applicationCycleId", "domainId", "userId")
    VALUES (
      gen_random_uuid()::text,
      (SELECT "applicationCycleId" FROM "CycleReviewer" LIMIT 1),
      (SELECT "domainId" FROM "CycleReviewer" LIMIT 1),
      'does-not-exist-userid'
    );
    RAISE NOTICE '  FAIL: invalid userId was accepted (FK missing or wrong target)';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '  PASS: invalid userId rejected as expected (FK to User enforced)';
  END;
END $$;

-- ─── 10. BACKFILL SPOT-CHECK: an admin from DALIMember.roles[] is in AdminMembership ───
\echo ''
\echo '=== T10: spot-check role backfill — admins migrated cleanly ==='
-- Compare AdminMembership count to what *should* be there based on legacy.
-- Phase 1 verification reported 9 admins via DALIMember.roles[]; we expect
-- 9 AdminMembership rows. Each one has a User backing it.
SELECT
  COUNT(*) AS admin_membership_count,
  COUNT(DISTINCT u."daliEmail") AS distinct_admin_emails
FROM "AdminMembership" am
JOIN "User" u ON u.id = am."userId";
-- PASS: admin_membership_count = 9 (or matches your Phase 1 count).

-- ─── 11. BACKFILL SPOT-CHECK: hiring leads got CoreAssignment in current term ───
\echo ''
\echo '=== T11: spot-check Hiring Lead → CoreAssignment with current term ==='
SELECT
  u."daliEmail",
  t.code AS term_code,
  ca."leadTitle"
FROM "CoreAssignment" ca
JOIN "User" u ON u.id = ca."userId"
JOIN "Term" t ON t.id = ca."termId"
WHERE ca."leadTitle" = 'Hiring Lead'
ORDER BY u."daliEmail";
-- PASS: 8 rows (matches Phase 1's hiring_lead_members count); all rows have
-- a real term_code (current term — likely 26S).

-- ─── 12. BACKFILL SPOT-CHECK: DomainLeadAssignment.termId backfilled ───────
\echo ''
\echo '=== T12: DLA termId populated for legacy rows ==='
SELECT
  COUNT(*) AS total_dlas,
  COUNT(*) FILTER (WHERE "termId" IS NOT NULL) AS with_termId,
  COUNT(DISTINCT "termId") AS distinct_terms_used
FROM "DomainLeadAssignment";
-- PASS: with_termId = total_dlas (42); distinct_terms_used = 1.

-- ─── 13. BACKFILL SPOT-CHECK: orphan-migrated User rows ────────────────────
\echo ''
\echo '=== T13: orphan-migrated Users (newly created in Phase 2 M2) ==='
SELECT COUNT(*) AS new_users_with_daliEmail_but_no_session
FROM "User" u
WHERE u."daliEmail" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Session" s WHERE s."userId" = u.id);
-- PASS: ~95 (matches the orphan migration count from Phase 1).

-- ─── 14. LEGACY DROP VERIFICATION: column references in queries fail ──────
\echo ''
\echo '=== T14: verify the old daliMemberId column truly cannot be queried ==='
DO $$
BEGIN
  BEGIN
    PERFORM "daliMemberId" FROM "CycleReviewer" LIMIT 1;
    RAISE NOTICE '  FAIL: daliMemberId is still queryable (drop didn''t happen)';
  EXCEPTION WHEN undefined_column THEN
    RAISE NOTICE '  PASS: daliMemberId column does not exist (drop succeeded)';
  END;
END $$;

-- ─── 15. LEGACY DROP VERIFICATION: User.googleRefreshToken truly dropped ──
\echo ''
\echo '=== T15: verify User.googleRefreshToken truly dropped ==='
DO $$
BEGIN
  BEGIN
    PERFORM "googleRefreshToken" FROM "User" LIMIT 1;
    RAISE NOTICE '  FAIL: googleRefreshToken is still queryable';
  EXCEPTION WHEN undefined_column THEN
    RAISE NOTICE '  PASS: googleRefreshToken column does not exist';
  END;
END $$;

ROLLBACK;

\echo ''
\echo '=== Done — all writes rolled back. Look for PASS/FAIL markers above. ==='
