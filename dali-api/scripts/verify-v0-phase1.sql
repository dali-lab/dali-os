-- Verify v0 Phase 1 migration landed cleanly.
--
-- Run against staging Neon (or any post-Phase-1 DB):
--   flyctl proxy 5432:5432 -a dali-api-staging &
--   psql 'postgres://...localhost:5432/neondb' -f scripts/verify-v0-phase1.sql
-- or paste into Neon's SQL editor for the staging branch.
--
-- Each query is labeled. Look for:
--   - "PASS" / "FAIL" lines
--   - row counts that match expectations
--   - empty result sets in the integrity-check section

\echo '=== 1. New tables present (expect 43 rows) ==='
SELECT COUNT(*) AS new_tables_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'Term', 'DomainEligibility', 'ProjectAssignment', 'MentorshipPair',
    'CoreAssignment', 'InstructorAssignment', 'AdminMembership', 'JobCodeLookup',
    'Project', 'ProjectTermStatus', 'ProjectRoleRequest', 'Epic', 'Sprint',
    'Task', 'TaskAssignee', 'TaskComment',
    'EducationOffering', 'EducationSession', 'EducationApplication',
    'EducationApplicationQuestion', 'EducationApplicationAnswer',
    'EducationAttendance', 'EducationAssignment', 'EducationSubmission',
    'EducationAnnouncement',
    'StaffingCycle', 'StaffingPreference', 'EssentialityForm',
    'EssentialityRating', 'StaffingAssignment',
    'Page', 'PageTemplate', 'MentorNote', 'MentorNoteTemplate',
    'NotificationEvent', 'NotificationPreference',
    'PartnerOrg', 'PartnerUser', 'ProjectPartner',
    'OAuthClient', 'OAuthGrant', 'OneTimeToken', 'GmailIntegration'
  );
-- Expect: 43. Any other number → some new tables missing.

\echo '=== 2. New User columns present (expect 11 rows) ==='
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'User'
  AND column_name IN (
    'classYear','graduatedAt','pronouns','photoUrl','bioDocId','major',
    'hometown','linkedinUrl','githubUrl','personalSite','personalEmail'
  )
ORDER BY column_name;
-- Expect: 11 rows, all nullable.

\echo '=== 3. Legacy columns still present (Phase 1 is additive — these survive until Phase 2) ==='
SELECT
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='User' AND column_name='googleAccessToken') AS user_google_access_token,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='DALIMember' AND column_name='firstName') AS dalimember_firstName,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='DALIMember' AND column_name='roles') AS dalimember_roles,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='CycleReviewer' AND column_name='daliMemberId') AS cyclereviewer_daliMemberId,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='DomainLeadAssignment' AND column_name='memberId') AS dla_memberId;
-- Expect: all `true` (Phase 1 didn't drop anything).

\echo '=== 4. New columns on existing models ==='
SELECT
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='Application' AND column_name='applicationType') AS application_applicationType,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='Domain' AND column_name='code') AS domain_code,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='Domain' AND column_name='displayName') AS domain_displayName,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='Domain' AND column_name='isInternProgram') AS domain_isInternProgram,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='Domain' AND column_name='active') AS domain_active,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='DomainLeadAssignment' AND column_name='termId') AS dla_termId;
-- Expect: all `true`.

\echo '=== 5. Existing data unchanged — User table ==='
SELECT COUNT(*) AS total_users, COUNT(*) FILTER (WHERE "daliEmail" IS NOT NULL) AS users_with_daliEmail
FROM "User";

\echo '=== 6. Existing data unchanged — DALIMember ==='
SELECT
  COUNT(*) AS total_members,
  COUNT(*) FILTER (WHERE "userId" IS NULL) AS orphan_members,
  COUNT(*) FILTER (WHERE 'Admin' = ANY("roles")) AS admin_members,
  COUNT(*) FILTER (WHERE 'HiringLead' = ANY("roles")) AS hiring_lead_members
FROM "DALIMember";
-- Expect: total > 0; orphan ~116 (these will migrate in Phase 2);
-- admin + hiring_lead counts non-zero.

\echo '=== 7. Application cycle still intact ==='
SELECT
  c.id, c.name,
  (SELECT "newStatus" FROM "ApplicationCycleStatusUpdate" WHERE "applicationCycleId" = c.id ORDER BY "createdAt" DESC LIMIT 1) AS current_status,
  (SELECT COUNT(*) FROM "Application" WHERE "applicationCycleId" = c.id) AS application_count
FROM "ApplicationCycle" c
ORDER BY c."createdAt" DESC
LIMIT 5;

\echo '=== 8. Hiring FK integrity (Phase 1 left these unchanged) ==='
SELECT
  (SELECT COUNT(*) FROM "CycleReviewer") AS reviewers,
  (SELECT COUNT(*) FROM "CycleInterviewer") AS interviewers,
  (SELECT COUNT(*) FROM "ApplicationReview") AS reviews,
  (SELECT COUNT(*) FROM "Decision") AS decisions,
  (SELECT COUNT(*) FROM "Interview") AS interviews,
  (SELECT COUNT(*) FROM "DomainLeadAssignment") AS domain_lead_assignments;

\echo '=== 9. v0 reference data status (informational — need to run v0-reference seed before Phase 2) ==='
SELECT
  (SELECT COUNT(*) FROM "Term") AS term_count,
  (SELECT COUNT(*) FROM "Domain" WHERE "code" IS NOT NULL) AS domains_with_code,
  (SELECT COUNT(*) FROM "Domain" WHERE "code" IS NULL) AS domains_missing_code,
  (SELECT COUNT(*) FROM "PageTemplate") AS page_templates,
  (SELECT COUNT(*) FROM "MentorNoteTemplate") AS mentor_templates;
-- Expect Term > 0 and 17 domains with code (after v0-reference seed).
-- If Term = 0 — run `npm run db:seed:v0-reference` against staging
-- before deploying Phase 2.

\echo '=== 10. New tables empty (Phase 1 creates them; population happens in feature tracks) ==='
SELECT
  (SELECT COUNT(*) FROM "ProjectAssignment") AS project_assignments,
  (SELECT COUNT(*) FROM "CoreAssignment") AS core_assignments,
  (SELECT COUNT(*) FROM "AdminMembership") AS admin_memberships,
  (SELECT COUNT(*) FROM "DomainEligibility") AS domain_eligibilities,
  (SELECT COUNT(*) FROM "Project") AS projects,
  (SELECT COUNT(*) FROM "EducationOffering") AS offerings,
  (SELECT COUNT(*) FROM "StaffingCycle") AS staffing_cycles,
  (SELECT COUNT(*) FROM "OAuthClient") AS oauth_clients,
  (SELECT COUNT(*) FROM "GmailIntegration") AS gmail_integrations;
-- Expect all 0 except possibly gmail_integrations if anything's run since deploy.

\echo '=== 11. Session.grantId FK constraint added ==='
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = '"Session"'::regclass
  AND conname LIKE '%grantId%';
-- Expect: 1 row referencing OAuthGrant("id").

\echo '=== 12. Migration history ==='
SELECT migration_name, finished_at
FROM _prisma_migrations
WHERE migration_name LIKE '%v0_phase1%' OR migration_name LIKE '%calendar_v0%'
ORDER BY finished_at DESC
LIMIT 5;
-- Expect: 20260514040346_v0_phase1_additive finished_at non-null.
