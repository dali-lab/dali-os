-- Verify v0 Phase 2 migration landed cleanly.
--
-- Run against staging (or any post-Phase-2 DB):
--   flyctl proxy 5432:5432 -a dali-api-staging &
--   psql 'postgres://...' -f scripts/verify-v0-phase2.sql
--
-- Compare counts to the Phase 1 verification output you captured earlier
-- (215 users, 142 DALIMembers, 95 orphans, 45 reviewers, 18 interviewers,
-- 118 reviews, 42 DLAs).

\echo '=== 1. Migration history (expect both phase1_additive + phase2_identity_refactor) ==='
SELECT migration_name, finished_at, applied_steps_count
FROM _prisma_migrations
WHERE migration_name LIKE '%v0_phase%' OR migration_name LIKE '%calendar_v0%'
ORDER BY finished_at DESC
LIMIT 5;

\echo ''
\echo '=== 2. DALIMember slim-down ==='
-- DALIMember should now have only: id, userId, createdAt, updatedAt.
-- Dropped: firstName, lastName, daliEmail, dartmouthEmail, did, roles.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='DALIMember'
ORDER BY column_name;
-- Expect: 4 rows. Anything else = drops didn't happen.

\echo ''
\echo '=== 3. User.google* dropped ==='
SELECT
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='User' AND column_name='googleAccessToken') AS still_has_googleAccessToken,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='User' AND column_name='googleRefreshToken') AS still_has_googleRefreshToken,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='User' AND column_name='googleTokenExpiresAt') AS still_has_googleTokenExpiresAt;
-- Expect: all `false`.

\echo ''
\echo '=== 4. Hiring FK renames ==='
SELECT
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='CycleReviewer' AND column_name='daliMemberId') AS cyclereviewer_still_has_daliMemberId,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='CycleReviewer' AND column_name='userId') AS cyclereviewer_has_userId,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='CycleInterviewer' AND column_name='daliMemberId') AS cycleinterviewer_still_has_daliMemberId,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='CycleInterviewer' AND column_name='userId') AS cycleinterviewer_has_userId,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='DomainLeadAssignment' AND column_name='memberId') AS dla_still_has_memberId,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='DomainLeadAssignment' AND column_name='userId') AS dla_has_userId;
-- Expect: still_has_*: all false; has_userId: all true.

\echo ''
\echo '=== 5. NOT NULL constraints tightened ==='
SELECT
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='DALIMember' AND column_name='userId') AS dalimember_userId_nullable,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='DomainLeadAssignment' AND column_name='termId') AS dla_termId_nullable,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='Domain' AND column_name='code') AS domain_code_nullable,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='Domain' AND column_name='displayName') AS domain_displayName_nullable,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='CycleReviewer' AND column_name='userId') AS cyclereviewer_userId_nullable,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='CycleInterviewer' AND column_name='userId') AS cycleinterviewer_userId_nullable,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='DomainLeadAssignment' AND column_name='userId') AS dla_userId_nullable;
-- Expect: all 'NO'.

\echo ''
\echo '=== 6. MemberRole enum dropped ==='
SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = 'MemberRole') AS member_role_enum_still_exists;
-- Expect: `false`.

\echo ''
\echo '=== 7. OAuthAccountType collapsed to member-only ==='
SELECT array_agg(enumlabel ORDER BY enumsortorder) AS oauth_account_type_values
FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'OAuthAccountType');
-- Expect: {member}. Anything else = collapse didn't happen.

\echo ''
\echo '=== 8. FK targets now point at User (not DALIMember) ==='
SELECT
  conrelid::regclass::text AS table_name,
  conname,
  confrelid::regclass::text AS references_table
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid::regclass::text IN ('"CycleReviewer"', '"CycleInterviewer"', '"Decision"', '"ApplicationReview"', '"DelibsSession"', '"EmailTemplateVersion"', '"ConfidentialityAgreementVersion"', '"DomainLeadAssignment"', '"DALIMember"')
  AND (conname LIKE '%userId%' OR conname LIKE '%madeBy%' OR conname LIKE '%submittedBy%' OR conname LIKE '%openedBy%' OR conname LIKE '%createdBy%')
ORDER BY conrelid::regclass::text, conname;
-- Expect: all references_table values = `"User"` (or "Term" for DLA_termId_fkey).

\echo ''
\echo '=== 9. Data integrity — DALIMember orphans resolved ==='
SELECT
  COUNT(*) AS total_members,
  COUNT(*) FILTER (WHERE "userId" IS NULL) AS orphan_members
FROM "DALIMember";
-- Expect: total = 143 (was 142 in Phase 1 + 95 orphan migrations promoted to
-- User rows; pre-existing DALIMember count survived);
-- orphan_members = 0.

\echo ''
\echo '=== 10. Data integrity — User count grew to absorb orphans ==='
SELECT COUNT(*) AS total_users FROM "User";
-- Expect: ~310 (215 prior + 95 migrated orphans). May differ slightly if
-- some orphans had matching daliEmails (ON CONFLICT DO NOTHING).

\echo ''
\echo '=== 11. Hiring FK rows preserved (counts should match Phase 1 verification) ==='
SELECT
  (SELECT COUNT(*) FROM "CycleReviewer") AS reviewers,
  (SELECT COUNT(*) FROM "CycleInterviewer") AS interviewers,
  (SELECT COUNT(*) FROM "ApplicationReview") AS reviews,
  (SELECT COUNT(*) FROM "Decision") AS decisions,
  (SELECT COUNT(*) FROM "Interview") AS interviews,
  (SELECT COUNT(*) FROM "DomainLeadAssignment") AS domain_lead_assignments;
-- Expect: 45 reviewers, 18 interviewers, 118 reviews (was 116 — drift fine),
-- 0 decisions, 0 interviews, 42 DLAs.

\echo ''
\echo '=== 12. All hiring FK userId columns populated (no NULLs) ==='
SELECT
  (SELECT COUNT(*) FROM "CycleReviewer" WHERE "userId" IS NULL) AS reviewer_nulls,
  (SELECT COUNT(*) FROM "CycleInterviewer" WHERE "userId" IS NULL) AS interviewer_nulls,
  (SELECT COUNT(*) FROM "DomainLeadAssignment" WHERE "userId" IS NULL) AS dla_userId_nulls,
  (SELECT COUNT(*) FROM "DomainLeadAssignment" WHERE "termId" IS NULL) AS dla_termId_nulls,
  (SELECT COUNT(*) FROM "Decision" WHERE "madeById" IS NULL) AS decision_nulls,
  (SELECT COUNT(*) FROM "DelibsSession" WHERE "openedById" IS NULL) AS delibs_nulls;
-- Expect: all 0. (ApplicationReview.submittedById is intentionally nullable —
-- represents unsubmitted reviews — not checked here.)

\echo ''
\echo '=== 13. AdminMembership + CoreAssignment backfill ==='
SELECT
  (SELECT COUNT(*) FROM "AdminMembership") AS admin_memberships,
  (SELECT COUNT(*) FROM "CoreAssignment" WHERE "leadTitle" = 'Hiring Lead') AS hiring_lead_core_assignments;
-- Expect: admin_memberships = 9 (matches Phase 1 admin_members count);
-- hiring_lead_core_assignments = 8 (matches Phase 1 hiring_lead_members).

\echo ''
\echo '=== 14. GmailIntegration backfill (admin Gmail-authorize accounts) ==='
SELECT
  COUNT(*) AS gmail_integrations,
  array_agg("sendAsEmail" ORDER BY "sendAsEmail") AS send_as_emails
FROM "GmailIntegration";
-- Expect: 1-2 rows for the dali admin accounts that ran /admin/authorize-gmail.
-- send_as_emails should include applications@dali.dartmouth.edu.

\echo ''
\echo '=== 15. Cycle data still intact and queryable through new FK shape ==='
SELECT
  cr.id AS reviewer_id,
  u."firstName", u."lastName", u."daliEmail",
  d."displayName" AS domain
FROM "CycleReviewer" cr
JOIN "User" u ON u.id = cr."userId"
JOIN "Domain" d ON d.id = cr."domainId"
LIMIT 5;
-- Expect: 5 rows joined cleanly. Names and domains visible.

\echo ''
\echo '=== 16. Sample post-Phase-2 user with full role view ==='
SELECT
  u.id,
  u."firstName" || ' ' || u."lastName" AS name,
  u."daliEmail",
  (SELECT COUNT(*) > 0 FROM "DALIMember" m WHERE m."userId" = u.id) AS is_lab_member,
  (SELECT COUNT(*) > 0 FROM "AdminMembership" am WHERE am."userId" = u.id) AS is_admin,
  (SELECT COUNT(*) FROM "CoreAssignment" ca WHERE ca."userId" = u.id) AS core_assignments,
  (SELECT array_agg(d."displayName") FROM "DomainLeadAssignment" dla JOIN "Domain" d ON d.id = dla."domainId" WHERE dla."userId" = u.id) AS lead_domains
FROM "User" u
WHERE u."daliEmail" IS NOT NULL
ORDER BY (SELECT COUNT(*) FROM "AdminMembership" am WHERE am."userId" = u.id) DESC,
         u."lastName"
LIMIT 10;
