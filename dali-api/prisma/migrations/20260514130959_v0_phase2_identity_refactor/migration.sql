-- ═══ V0 Phase 2: Destructive Identity Refactor ═══════════════════════════════
--
-- Coordinated with cycle staff (cycle is Completed before this runs) and
-- executed during a maintenance window with zero active write traffic. Total
-- expected runtime < 5 seconds on <10k rows. Single transaction so a
-- mid-statement failure rolls back cleanly.
--
-- See V0_PHASE2_PLAN.md for the design and rollback path (Neon snapshot
-- taken immediately before deploy).
--
-- The migration is broken into:
--   M1: Add staging columns + indexes that the backfill needs.
--   M2: Migrate orphan DALIMember rows (NULL userId) → new User rows.
--   M3: Backfill data from DALIMember → User, hiring FKs → userId, etc.
--   M4: Drop old columns, tighten constraints, drop dead enums.
--
-- Prisma wraps each migration in its own transaction; no explicit
-- BEGIN/COMMIT needed (and an explicit pair can mask abort errors).

-- ═══ M1: staging columns for hiring FK renames ════════════════════════════
-- The old daliMemberId/memberId columns hold DALIMember.id values; we need
-- to populate userId from DALIMember.userId before swapping.

ALTER TABLE "CycleReviewer"        ADD COLUMN "userId_new" TEXT;
ALTER TABLE "CycleInterviewer"     ADD COLUMN "userId_new" TEXT;
ALTER TABLE "DomainLeadAssignment" ADD COLUMN "userId_new" TEXT;

-- ═══ M2: migrate orphan DALIMember rows (NULL userId) ═════════════════════
-- These are contact-info-only rows from the legacy Notion sync. Promote
-- each to a real User row so the upcoming `userId SET NOT NULL` succeeds.
-- We reuse the DALIMember.id as the new User.id (both cuids; no collision
-- since DALIMember.id is unique and no existing User shares it).

-- INSERT uses ON CONFLICT DO NOTHING (without column spec) so that
-- conflicts on ANY unique constraint (daliEmail, netId, or did's lowercase
-- collision with a pre-existing User.netId) skip cleanly. Skipped rows are
-- handled by the linking UPDATE below, which keys on daliEmail.
INSERT INTO "User" (id, "createdAt", "updatedAt", "firstName", "lastName", "daliEmail", "netId")
SELECT
  m.id,
  m."createdAt",
  m."updatedAt",
  COALESCE(NULLIF(m."firstName", ''), 'Unknown'),
  COALESCE(NULLIF(m."lastName",  ''), ''),
  m."daliEmail",
  -- Only set netId if no existing User already owns this value. Otherwise
  -- leave NULL and let the user complete their identity by signing in.
  CASE
    WHEN m."did" IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM "User" u WHERE u."netId" = LOWER(m."did"))
      THEN NULL
    ELSE LOWER(m."did")
  END
FROM "DALIMember" m
WHERE m."userId" IS NULL
  AND m."daliEmail" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Link the freshly-created User rows back to their DALIMember.
UPDATE "DALIMember" m
SET "userId" = u.id
FROM "User" u
WHERE m."userId" IS NULL AND m."daliEmail" = u."daliEmail";

-- Discard any DALIMember row that still has no userId (no daliEmail to
-- migrate, or daliEmail collided with a non-member User during INSERT).
-- These should be rare; the DELETE is defensive.
DELETE FROM "DALIMember" WHERE "userId" IS NULL;

-- ═══ M3: backfills ════════════════════════════════════════════════════════

-- M3a. Backfill User.netId from DALIMember.did where:
--   (a) the User doesn't already have a netId, AND
--   (b) no other User already owns the target netId value.
-- Per V0_PLAN.md: netId === did (same Dartmouth identifier, case-normalized).
-- Case (b) typically arises when a member logged in via CAS first (got
-- netId='f006jnh'), and a separate DALIMember row linked to a DIFFERENT
-- User has did='F006JNH'. We skip rather than collide — the second User
-- can still operate without a netId; if they later log in via CAS,
-- linkCasToGoogleUser will merge them into the correct User row.
UPDATE "User" u
SET "netId" = LOWER(m."did")
FROM "DALIMember" m
WHERE u.id = m."userId"
  AND u."netId" IS NULL
  AND m."did" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "User" u2 WHERE u2."netId" = LOWER(m."did") AND u2.id <> u.id
  );

-- M3b. Backfill User.firstName/lastName from DALIMember where missing.
-- (Defensive; in practice User rows have these populated.)
UPDATE "User" u
SET "firstName" = COALESCE(NULLIF(u."firstName", ''), m."firstName", 'Unknown'),
    "lastName"  = COALESCE(NULLIF(u."lastName",  ''), m."lastName",  '')
FROM "DALIMember" m
WHERE u.id = m."userId"
  AND (u."firstName" IS NULL OR u."firstName" = '' OR u."lastName" IS NULL OR u."lastName" = '');

-- M3c. MemberRole[] → AdminMembership / CoreAssignment.
INSERT INTO "AdminMembership" (id, "userId", "grantedAt")
SELECT
  gen_random_uuid()::text,
  m."userId",
  NOW()
FROM "DALIMember" m
WHERE m."userId" IS NOT NULL AND 'Admin' = ANY(m."roles")
ON CONFLICT ("userId") DO NOTHING;

-- HiringLead → CoreAssignment with the current term + leadTitle="Hiring Lead".
-- Also backfills DomainLeadAssignment.termId for rows that still have it
-- NULL after Phase 1.
--
-- Tolerant of an empty Term table (CI runs migrations against a fresh DB
-- before seeding; in prod the operator runs v0-reference seed first). If
-- there's no Term row AND there's actual data that needs one, raise — the
-- NOT NULL ALTER below would catch a NULL termId anyway, but a clear error
-- message is friendlier.
DO $$
DECLARE
  cur_term_id text;
  hiring_lead_count int;
  null_term_dla_count int;
BEGIN
  SELECT COUNT(*) INTO hiring_lead_count
  FROM "DALIMember" WHERE 'HiringLead' = ANY("roles") AND "userId" IS NOT NULL;

  SELECT COUNT(*) INTO null_term_dla_count
  FROM "DomainLeadAssignment" WHERE "termId" IS NULL;

  IF hiring_lead_count = 0 AND null_term_dla_count = 0 THEN
    -- No data needs a Term reference. Skip the rest cleanly.
    RETURN;
  END IF;

  SELECT id INTO cur_term_id
  FROM "Term"
  WHERE "startDate" <= NOW() AND "endDate" >= NOW()
  ORDER BY "sortKey" DESC LIMIT 1;

  IF cur_term_id IS NULL THEN
    -- Fall back to the most recent term if none is "current" (e.g., between
    -- terms during the maintenance window).
    SELECT id INTO cur_term_id
    FROM "Term"
    ORDER BY "sortKey" DESC LIMIT 1;
  END IF;

  IF cur_term_id IS NULL THEN
    RAISE EXCEPTION 'Phase 2 migration: data requires a Term but none exists (% HiringLead members, % DomainLeadAssignment rows with NULL termId). Run npm run db:seed:v0-reference before deploying.', hiring_lead_count, null_term_dla_count;
  END IF;

  INSERT INTO "CoreAssignment" (id, "userId", "termId", "leadTitle")
  SELECT
    gen_random_uuid()::text,
    m."userId",
    cur_term_id,
    'Hiring Lead'
  FROM "DALIMember" m
  WHERE m."userId" IS NOT NULL
    AND 'HiringLead' = ANY(m."roles")
    AND NOT EXISTS (
      SELECT 1 FROM "CoreAssignment" ca
      WHERE ca."userId" = m."userId"
        AND ca."termId" = cur_term_id
        AND ca."leadTitle" = 'Hiring Lead'
    );

  -- M3d. DomainLeadAssignment.termId: backfill any NULL to the current term.
  UPDATE "DomainLeadAssignment" SET "termId" = cur_term_id WHERE "termId" IS NULL;
END $$;

-- M3e. CycleReviewer / CycleInterviewer / DomainLeadAssignment: populate
-- userId_new from the existing daliMemberId/memberId join.
UPDATE "CycleReviewer" cr
SET "userId_new" = m."userId"
FROM "DALIMember" m
WHERE cr."daliMemberId" = m.id;

UPDATE "CycleInterviewer" ci
SET "userId_new" = m."userId"
FROM "DALIMember" m
WHERE ci."daliMemberId" = m.id;

UPDATE "DomainLeadAssignment" dla
SET "userId_new" = m."userId"
FROM "DALIMember" m
WHERE dla."memberId" = m.id;

-- M3f. Translate DALIMember.id → User.id for the six FK columns that point
-- at DALIMember today. The column NAME stays (madeById, submittedById,
-- openedById, createdById); only the referenced table changes.
UPDATE "Decision" d
SET "madeById" = m."userId"
FROM "DALIMember" m
WHERE d."madeById" = m.id;

UPDATE "ApplicationReview" ar
SET "submittedById" = m."userId"
FROM "DALIMember" m
WHERE ar."submittedById" = m.id;

UPDATE "DelibsSession" ds
SET "openedById" = m."userId"
FROM "DALIMember" m
WHERE ds."openedById" = m.id;

UPDATE "LegacyEmailTemplate" lt
SET "createdById" = m."userId"
FROM "DALIMember" m
WHERE lt."createdById" = m.id;

UPDATE "EmailTemplateVersion" etv
SET "createdById" = m."userId"
FROM "DALIMember" m
WHERE etv."createdById" = m.id;

UPDATE "ConfidentialityAgreementVersion" cav
SET "createdById" = m."userId"
FROM "DALIMember" m
WHERE cav."createdById" = m.id;

-- M3g. GmailIntegration backfill from User.google*. Affects the 1–2 admin
-- accounts that have completed /admin/authorize-gmail. Phase 1 added
-- GmailIntegration; this migrates the credentials over so the Phase 2 code
-- (which reads GmailIntegration, not User.google*) keeps working.
INSERT INTO "GmailIntegration" (id, "userId", "sendAsEmail", "oauthTokens", "tokenExpiresAt", "enabled", "linkedAt")
SELECT
  gen_random_uuid()::text,
  u.id,
  COALESCE(u."daliEmail", u."dartmouthEmail", 'unknown@dali.dartmouth.edu'),
  u."googleRefreshToken",
  u."googleTokenExpiresAt",
  TRUE,
  NOW()
FROM "User" u
WHERE u."googleRefreshToken" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "GmailIntegration" g WHERE g."userId" = u.id);

-- M3h. Defensive Domain.code/displayName backfill (Phase 1 reference seed
-- should already populate these; this catches any rows added between Phase
-- 1 and Phase 2 that skipped the seed path).
UPDATE "Domain" SET "code" = REPLACE("name", ' ', '') WHERE "code" IS NULL;
UPDATE "Domain" SET "displayName" = "name" WHERE "displayName" IS NULL;

-- ═══ M4: structural changes (drops, renames, constraint tightening) ══════

-- OAuthAccountType: collapse to `member` only. OAuthSession.accountType
-- rows with non-member values become NULL (and the row is short-lived
-- anyway — 10 min TTL — so this is benign).
CREATE TYPE "OAuthAccountType_new" AS ENUM ('member');
ALTER TABLE "OAuthSession" ALTER COLUMN "accountType" TYPE "OAuthAccountType_new"
  USING (CASE WHEN "accountType"::text = 'member' THEN 'member'::"OAuthAccountType_new" ELSE NULL END);
ALTER TYPE "OAuthAccountType" RENAME TO "OAuthAccountType_old";
ALTER TYPE "OAuthAccountType_new" RENAME TO "OAuthAccountType";
DROP TYPE "OAuthAccountType_old";

-- Drop old foreign keys.
ALTER TABLE "DALIMember"                      DROP CONSTRAINT "DALIMember_userId_fkey";
ALTER TABLE "CycleReviewer"                   DROP CONSTRAINT "CycleReviewer_daliMemberId_fkey";
ALTER TABLE "CycleInterviewer"                DROP CONSTRAINT "CycleInterviewer_daliMemberId_fkey";
ALTER TABLE "Decision"                        DROP CONSTRAINT "Decision_madeById_fkey";
ALTER TABLE "ApplicationReview"               DROP CONSTRAINT "ApplicationReview_submittedById_fkey";
ALTER TABLE "DelibsSession"                   DROP CONSTRAINT "DelibsSession_openedById_fkey";
ALTER TABLE "LegacyEmailTemplate"             DROP CONSTRAINT "LegacyEmailTemplate_createdById_fkey";
ALTER TABLE "EmailTemplateVersion"            DROP CONSTRAINT "EmailTemplateVersion_createdById_fkey";
ALTER TABLE "ConfidentialityAgreementVersion" DROP CONSTRAINT "ConfidentialityAgreementVersion_createdById_fkey";
ALTER TABLE "DomainLeadAssignment"            DROP CONSTRAINT "DomainLeadAssignment_memberId_fkey";
ALTER TABLE "DomainLeadAssignment"            DROP CONSTRAINT "DomainLeadAssignment_termId_fkey";

-- Drop old indexes.
DROP INDEX "DALIMember_daliEmail_key";
DROP INDEX "DALIMember_dartmouthEmail_key";
DROP INDEX "DALIMember_did_key";
DROP INDEX "CycleReviewer_daliMemberId_applicationCycleId_domainId_key";
DROP INDEX "CycleInterviewer_daliMemberId_applicationCycleId_domainId_key";
DROP INDEX "DomainLeadAssignment_memberId_domainId_key";

-- User: drop google* columns. Backfill in M3g already moved any live data.
ALTER TABLE "User"
  DROP COLUMN "googleAccessToken",
  DROP COLUMN "googleRefreshToken",
  DROP COLUMN "googleTokenExpiresAt";

-- DALIMember: slim down to thin marker.
ALTER TABLE "DALIMember"
  DROP COLUMN "daliEmail",
  DROP COLUMN "dartmouthEmail",
  DROP COLUMN "did",
  DROP COLUMN "firstName",
  DROP COLUMN "lastName",
  DROP COLUMN "roles",
  ALTER COLUMN "userId" SET NOT NULL;

-- Domain: tighten code/displayName.
ALTER TABLE "Domain"
  ALTER COLUMN "code"        SET NOT NULL,
  ALTER COLUMN "displayName" SET NOT NULL;

-- CycleReviewer: complete the column rename.
ALTER TABLE "CycleReviewer" DROP COLUMN "daliMemberId";
ALTER TABLE "CycleReviewer" RENAME COLUMN "userId_new" TO "userId";
ALTER TABLE "CycleReviewer" ALTER COLUMN "userId" SET NOT NULL;

-- CycleInterviewer: same.
ALTER TABLE "CycleInterviewer" DROP COLUMN "daliMemberId";
ALTER TABLE "CycleInterviewer" RENAME COLUMN "userId_new" TO "userId";
ALTER TABLE "CycleInterviewer" ALTER COLUMN "userId" SET NOT NULL;

-- DomainLeadAssignment: complete column rename, tighten termId.
ALTER TABLE "DomainLeadAssignment" DROP COLUMN "memberId";
ALTER TABLE "DomainLeadAssignment" RENAME COLUMN "userId_new" TO "userId";
ALTER TABLE "DomainLeadAssignment"
  ALTER COLUMN "userId" SET NOT NULL,
  ALTER COLUMN "termId" SET NOT NULL;

-- Drop the now-unused MemberRole enum.
DROP TYPE "MemberRole";

-- Recreate unique constraints on the new column names.
CREATE UNIQUE INDEX "CycleReviewer_userId_applicationCycleId_domainId_key"
  ON "CycleReviewer"("userId", "applicationCycleId", "domainId");
CREATE UNIQUE INDEX "CycleInterviewer_userId_applicationCycleId_domainId_key"
  ON "CycleInterviewer"("userId", "applicationCycleId", "domainId");
CREATE UNIQUE INDEX "DomainLeadAssignment_userId_domainId_termId_key"
  ON "DomainLeadAssignment"("userId", "domainId", "termId");

-- Recreate foreign keys, now pointing at User (and Term).
ALTER TABLE "DALIMember"
  ADD CONSTRAINT "DALIMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CycleReviewer"
  ADD CONSTRAINT "CycleReviewer_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CycleInterviewer"
  ADD CONSTRAINT "CycleInterviewer_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Decision"
  ADD CONSTRAINT "Decision_madeById_fkey"
  FOREIGN KEY ("madeById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApplicationReview"
  ADD CONSTRAINT "ApplicationReview_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DelibsSession"
  ADD CONSTRAINT "DelibsSession_openedById_fkey"
  FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegacyEmailTemplate"
  ADD CONSTRAINT "LegacyEmailTemplate_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailTemplateVersion"
  ADD CONSTRAINT "EmailTemplateVersion_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConfidentialityAgreementVersion"
  ADD CONSTRAINT "ConfidentialityAgreementVersion_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DomainLeadAssignment"
  ADD CONSTRAINT "DomainLeadAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DomainLeadAssignment"
  ADD CONSTRAINT "DomainLeadAssignment_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
