# DALI OS v0 — Phase 2: Destructive Identity Refactor

Runs **after** the 2026-S hire cycle closes (`ApplicationCycleStatus = Completed` in prod). Coordinated with cycle staff. Staging Neon branch restored from prod snapshot and verified before prod rollout.

See `V0_PLAN.md` for the full v0 split and locked decisions. This doc covers Phase 2 only.

## Goal

After Phase 2 lands:
- `DALIMember` is a thin marker (`{ id, userId @unique NOT NULL, createdAt, updatedAt }`).
- All universal profile data lives on `User`. `user.firstName`, `user.daliEmail`, etc. — no `user.daliMember.<field>` indirection.
- 9 hiring tables FK to `User` directly, not `DALIMember`.
- `User.googleAccessToken / googleRefreshToken / googleTokenExpiresAt` columns are dropped. Gmail send-as moves to `GmailIntegration`. Free-busy uses `UserCalendarLink` exclusively.
- `MemberRole[]` enum is gone. Roles are derived from `CoreAssignment`, `AdminMembership`, etc.
- `OAuthAccountType` collapses to `member` only (Q11 / Q14 confirmations).
- `upsertUserFromGoogle` simplifies to a single `@dali.dartmouth.edu` branch.

## Pre-flight (must be true before merging Phase 2 to dev)

- [ ] Phase 1 migration deployed to dev, staging, and prod (≥1 week of soak)
- [ ] `feature/v0-phase2-identity-refactor` branched from latest `dev`
- [ ] Live cycle status = `Completed`. Confirm via `SELECT status, "createdAt" FROM "ApplicationCycle"`.
- [ ] Cycle staff sign-off that no further reads against pre-rename hiring data are expected
- [ ] Staging Neon branch reset from a fresh prod snapshot

## Migration sequence — one big PR, four migrations

Phase 2 is a destructive refactor; pgfence will flag it. We split into a sequence so each step is isolated and roll-back-friendly. Each migration is its own SQL file inside the same PR.

### M1 — Backfill staging columns (additive)

```sql
-- 1a. Add nullable userId columns on the 9 hiring tables that still FK to DALIMember.
ALTER TABLE "CycleReviewer"                    ADD COLUMN "userId" TEXT;
ALTER TABLE "CycleInterviewer"                 ADD COLUMN "userId" TEXT;
ALTER TABLE "DomainLeadAssignment"             ADD COLUMN "userId" TEXT;
ALTER TABLE "Decision"                         ADD COLUMN "madeByUserId" TEXT;
ALTER TABLE "ApplicationReview"                ADD COLUMN "submittedByUserId" TEXT;
ALTER TABLE "DelibsSession"                    ADD COLUMN "openedByUserId" TEXT;
ALTER TABLE "LegacyEmailTemplate"              ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "EmailTemplateVersion"             ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "ConfidentialityAgreementVersion"  ADD COLUMN "createdByUserId" TEXT;

-- 1b. Backfill from the existing DALIMember.userId join.
UPDATE "CycleReviewer"                   SET "userId"            = "DALIMember"."userId" FROM "DALIMember" WHERE "CycleReviewer"."daliMemberId"           = "DALIMember"."id";
UPDATE "CycleInterviewer"                SET "userId"            = "DALIMember"."userId" FROM "DALIMember" WHERE "CycleInterviewer"."daliMemberId"        = "DALIMember"."id";
UPDATE "DomainLeadAssignment"            SET "userId"            = "DALIMember"."userId" FROM "DALIMember" WHERE "DomainLeadAssignment"."memberId"         = "DALIMember"."id";
UPDATE "Decision"                        SET "madeByUserId"      = "DALIMember"."userId" FROM "DALIMember" WHERE "Decision"."madeById"                    = "DALIMember"."id";
UPDATE "ApplicationReview"               SET "submittedByUserId" = "DALIMember"."userId" FROM "DALIMember" WHERE "ApplicationReview"."submittedById"      = "DALIMember"."id";
UPDATE "DelibsSession"                   SET "openedByUserId"    = "DALIMember"."userId" FROM "DALIMember" WHERE "DelibsSession"."openedById"             = "DALIMember"."id";
UPDATE "LegacyEmailTemplate"             SET "createdByUserId"   = "DALIMember"."userId" FROM "DALIMember" WHERE "LegacyEmailTemplate"."createdById"      = "DALIMember"."id";
UPDATE "EmailTemplateVersion"            SET "createdByUserId"   = "DALIMember"."userId" FROM "DALIMember" WHERE "EmailTemplateVersion"."createdById"     = "DALIMember"."id";
UPDATE "ConfidentialityAgreementVersion" SET "createdByUserId"   = "DALIMember"."userId" FROM "DALIMember" WHERE "ConfidentialityAgreementVersion"."createdById" = "DALIMember"."id";

-- 1c. Add FK constraints (now valid since backfill is done).
ALTER TABLE "CycleReviewer"                   ADD CONSTRAINT "CycleReviewer_userId_fkey"                   FOREIGN KEY ("userId")            REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "CycleInterviewer"                ADD CONSTRAINT "CycleInterviewer_userId_fkey"                FOREIGN KEY ("userId")            REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "DomainLeadAssignment"            ADD CONSTRAINT "DomainLeadAssignment_userId_fkey"            FOREIGN KEY ("userId")            REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "Decision"                        ADD CONSTRAINT "Decision_madeByUserId_fkey"                  FOREIGN KEY ("madeByUserId")      REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "ApplicationReview"               ADD CONSTRAINT "ApplicationReview_submittedByUserId_fkey"    FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "DelibsSession"                   ADD CONSTRAINT "DelibsSession_openedByUserId_fkey"           FOREIGN KEY ("openedByUserId")    REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "LegacyEmailTemplate"             ADD CONSTRAINT "LegacyEmailTemplate_createdByUserId_fkey"    FOREIGN KEY ("createdByUserId")   REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "EmailTemplateVersion"            ADD CONSTRAINT "EmailTemplateVersion_createdByUserId_fkey"   FOREIGN KEY ("createdByUserId")   REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "ConfidentialityAgreementVersion" ADD CONSTRAINT "ConfidentialityAgreementVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
```

Reversibility: dropping columns and constraints. Old columns still active; nothing relies on the new ones yet.

### M2 — Backfill DALIMember orphans → User rows

```sql
-- 116 orphans (NULL userId, contact-info only). Create matching User rows
-- using daliEmail/firstName/lastName/did from DALIMember, then link.
INSERT INTO "User" (id, "createdAt", "updatedAt", "firstName", "lastName", "daliEmail", "netId")
SELECT
  m.id,                              -- reuse the DALIMember id as the new User id (safe — Users use cuid; this stays unique)
  m."createdAt",
  m."updatedAt",
  COALESCE(m."firstName", '?'),      -- required column; placeholder for empty rows
  COALESCE(m."lastName", '?'),
  m."daliEmail",
  LOWER(m."did")                     -- did is the same identifier as netId per Kiran's clarification; normalize
FROM "DALIMember" m
WHERE m."userId" IS NULL
  AND m."daliEmail" IS NOT NULL      -- skip totally-empty rows
ON CONFLICT ("daliEmail") DO NOTHING;

-- Link the now-existent User rows back to their DALIMember rows.
UPDATE "DALIMember" m
SET "userId" = u.id
FROM "User" u
WHERE m."userId" IS NULL AND m."daliEmail" = u."daliEmail";

-- Surface any remaining orphans (should be 0 after the above).
-- Run as a check, not a migration step. If non-zero, halt and inspect.
SELECT COUNT(*) AS still_orphaned FROM "DALIMember" WHERE "userId" IS NULL;
```

### M3 — Backfill User columns from DALIMember + Gmail integration

```sql
-- Promote DALIMember.did to User.netId for users who don't have a netId yet.
UPDATE "User" u
SET "netId" = LOWER(m."did")
FROM "DALIMember" m
WHERE u.id = m."userId"
  AND u."netId" IS NULL
  AND m."did" IS NOT NULL;

-- Backfill User.firstName / lastName from DALIMember for users whose User row
-- has placeholder values (shouldn't be any after Phase 1, but defensive).
UPDATE "User" u
SET "firstName" = COALESCE(NULLIF(u."firstName", ''), m."firstName", '?'),
    "lastName"  = COALESCE(NULLIF(u."lastName",  ''), m."lastName",  '?')
FROM "DALIMember" m
WHERE u.id = m."userId"
  AND (u."firstName" = '?' OR u."lastName" = '?');

-- Backfill MemberRole[] → CoreAssignment / AdminMembership.
-- Resolve current term once.
WITH current_term AS (
  SELECT id FROM "Term"
  WHERE "startDate" <= NOW() AND "endDate" >= NOW()
  ORDER BY "sortKey" DESC LIMIT 1
)
INSERT INTO "CoreAssignment" (id, "userId", "termId", "leadTitle")
SELECT
  gen_random_uuid()::text,
  m."userId",
  (SELECT id FROM current_term),
  'Hiring Lead'
FROM "DALIMember" m
WHERE m."userId" IS NOT NULL
  AND 'HiringLead' = ANY(m."roles")
  AND NOT EXISTS (
    SELECT 1 FROM "CoreAssignment" ca
    WHERE ca."userId" = m."userId"
      AND ca."termId" = (SELECT id FROM current_term)
      AND ca."leadTitle" = 'Hiring Lead'
  );

INSERT INTO "AdminMembership" (id, "userId", "grantedAt")
SELECT
  gen_random_uuid()::text,
  m."userId",
  NOW()
FROM "DALIMember" m
WHERE m."userId" IS NOT NULL
  AND 'Admin' = ANY(m."roles")
ON CONFLICT ("userId") DO NOTHING;

-- Backfill DomainLeadAssignment.termId from the current term.
WITH current_term AS (
  SELECT id FROM "Term"
  WHERE "startDate" <= NOW() AND "endDate" >= NOW()
  ORDER BY "sortKey" DESC LIMIT 1
)
UPDATE "DomainLeadAssignment"
SET "termId" = (SELECT id FROM current_term)
WHERE "termId" IS NULL;

-- Backfill GmailIntegration from User.google* for users who have a refresh
-- token (the Gmail send-as admin user(s)).
INSERT INTO "GmailIntegration" (id, "userId", "sendAsEmail", "oauthTokens", "tokenExpiresAt", "enabled", "linkedAt")
SELECT
  gen_random_uuid()::text,
  u.id,
  COALESCE(u."daliEmail", u."dartmouthEmail"),
  -- IMPORTANT: pre-Phase-2, the tokens on User.google* were stored
  -- plaintext (legacy). The Phase 2 code rewrite of /admin/authorize-gmail
  -- moves to encrypted-at-rest via lib/calendar-crypto. The first time the
  -- new code reads this row it should detect the legacy format, encrypt
  -- in place, and continue. App-level concern; not handled here.
  'LEGACY:' || u."googleRefreshToken",
  u."googleTokenExpiresAt",
  TRUE,
  NOW()
FROM "User" u
WHERE u."googleRefreshToken" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "GmailIntegration" g WHERE g."userId" = u.id);
```

### M4 — Drop legacy columns, tighten constraints, rename FK columns

```sql
-- 4a. Tighten DALIMember.userId.
ALTER TABLE "DALIMember" ALTER COLUMN "userId" SET NOT NULL;

-- 4b. Drop DALIMember duplicate columns.
ALTER TABLE "DALIMember"
  DROP COLUMN "firstName",
  DROP COLUMN "lastName",
  DROP COLUMN "daliEmail",
  DROP COLUMN "dartmouthEmail",
  DROP COLUMN "did",
  DROP COLUMN "roles";

-- 4c. Drop the MemberRole enum (no longer referenced).
DROP TYPE "MemberRole";

-- 4d. Drop legacy hiring FK columns. The new userId columns are in place.
ALTER TABLE "CycleReviewer"                   DROP CONSTRAINT IF EXISTS "CycleReviewer_daliMemberId_fkey",                   DROP COLUMN "daliMemberId";
ALTER TABLE "CycleInterviewer"                DROP CONSTRAINT IF EXISTS "CycleInterviewer_daliMemberId_fkey",                DROP COLUMN "daliMemberId";
ALTER TABLE "DomainLeadAssignment"            DROP CONSTRAINT IF EXISTS "DomainLeadAssignment_memberId_fkey",                DROP COLUMN "memberId";
ALTER TABLE "Decision"                        DROP CONSTRAINT IF EXISTS "Decision_madeById_fkey",                            DROP COLUMN "madeById";
ALTER TABLE "ApplicationReview"               DROP CONSTRAINT IF EXISTS "ApplicationReview_submittedById_fkey",              DROP COLUMN "submittedById";
ALTER TABLE "DelibsSession"                   DROP CONSTRAINT IF EXISTS "DelibsSession_openedById_fkey",                     DROP COLUMN "openedById";
ALTER TABLE "LegacyEmailTemplate"             DROP CONSTRAINT IF EXISTS "LegacyEmailTemplate_createdById_fkey",              DROP COLUMN "createdById";
ALTER TABLE "EmailTemplateVersion"            DROP CONSTRAINT IF EXISTS "EmailTemplateVersion_createdById_fkey",             DROP COLUMN "createdById";
ALTER TABLE "ConfidentialityAgreementVersion" DROP CONSTRAINT IF EXISTS "ConfidentialityAgreementVersion_createdById_fkey", DROP COLUMN "createdById";

-- 4e. Tighten userId columns on hiring tables.
ALTER TABLE "CycleReviewer"                   ALTER COLUMN "userId"            SET NOT NULL;
ALTER TABLE "CycleInterviewer"                ALTER COLUMN "userId"            SET NOT NULL;
ALTER TABLE "DomainLeadAssignment"            ALTER COLUMN "userId"            SET NOT NULL;
ALTER TABLE "Decision"                        ALTER COLUMN "madeByUserId"      SET NOT NULL;
ALTER TABLE "DelibsSession"                   ALTER COLUMN "openedByUserId"    SET NOT NULL;
ALTER TABLE "LegacyEmailTemplate"             ALTER COLUMN "createdByUserId"   SET NOT NULL;
ALTER TABLE "EmailTemplateVersion"            ALTER COLUMN "createdByUserId"   SET NOT NULL;
ALTER TABLE "ConfidentialityAgreementVersion" ALTER COLUMN "createdByUserId"   SET NOT NULL;
-- ApplicationReview.submittedById was nullable (submit/unsubmit); keep
-- submittedByUserId nullable to match.

-- 4f. Tighten DomainLeadAssignment.termId.
ALTER TABLE "DomainLeadAssignment" ALTER COLUMN "termId" SET NOT NULL;

-- 4g. Recreate unique constraints with new column names.
ALTER TABLE "CycleReviewer"        DROP CONSTRAINT IF EXISTS "CycleReviewer_daliMemberId_applicationCycleId_domainId_key";
ALTER TABLE "CycleReviewer"        ADD CONSTRAINT "CycleReviewer_userId_applicationCycleId_domainId_key" UNIQUE ("userId", "applicationCycleId", "domainId");
ALTER TABLE "CycleInterviewer"     DROP CONSTRAINT IF EXISTS "CycleInterviewer_daliMemberId_applicationCycleId_domainId_key";
ALTER TABLE "CycleInterviewer"     ADD CONSTRAINT "CycleInterviewer_userId_applicationCycleId_domainId_key" UNIQUE ("userId", "applicationCycleId", "domainId");
ALTER TABLE "DomainLeadAssignment" DROP CONSTRAINT IF EXISTS "DomainLeadAssignment_memberId_domainId_key";
ALTER TABLE "DomainLeadAssignment" ADD CONSTRAINT "DomainLeadAssignment_userId_domainId_termId_key" UNIQUE ("userId", "domainId", "termId");
ALTER TABLE "ApplicationReview"    DROP CONSTRAINT IF EXISTS "ApplicationReview_cycleReviewerId_domainApplicationId_key";
-- (Recreate unchanged — only column references changed.)
ALTER TABLE "ApplicationReview"    ADD CONSTRAINT "ApplicationReview_cycleReviewerId_domainApplicationId_key" UNIQUE ("cycleReviewerId", "domainApplicationId");

-- 4h. Drop User.google* columns.
ALTER TABLE "User"
  DROP COLUMN "googleAccessToken",
  DROP COLUMN "googleRefreshToken",
  DROP COLUMN "googleTokenExpiresAt";

-- 4i. Tighten Domain.code, Domain.displayName.
ALTER TABLE "Domain" ALTER COLUMN "code"        SET NOT NULL;
ALTER TABLE "Domain" ALTER COLUMN "displayName" SET NOT NULL;
-- Domain.name retained (legacy display fallback in lib/display.ts).
-- Drop in a follow-up if/when display.ts is rewritten.
```

## Code changes shipping in the same PR

The schema-level rename is mechanical, but the code that reads/writes via Prisma needs updates. Touch list (file-by-file targets, not exhaustive):

- `prisma/schema.prisma` — relations on hiring models flip from `DALIMember` to `User`; drop `roles` field; collapse `OAuthAccountType`.
- `app/lib/auth/` — directory split (per Q6); `requireAuth`, `validateCasTicket` move to `cookie-login.ts`.
- `app/lib/auth/oauth-provider.ts` — `upsertUserFromGoogle` collapses to member branch only; `OAuthAccountType` references removed.
- `app/lib/auth/linking.ts` — add CAS→Google merge (per Q9 / Cl-4).
- `app/lib/roles.ts` — rewritten per `V0_PLAN.md` §"Identity model". `MemberRole` references gone.
- `app/lib/collabAuth.ts` — `daliMemberId` reads switch to `userId`.
- `app/lib/google-calendar.ts` — delete `fetchBusyFromLegacyUserTokens`. Caller falls back to empty.
- `app/lib/gmail.ts` (existing) and `lib/email.ts` — read from `GmailIntegration`.
- `app/routes/admin.authorize-gmail.callback.ts` — write to `GmailIntegration`.
- `app/routes/api.email.send.ts`, `hiring/lib/interview-emails.ts`, `hiring/lib/extension-notice.ts`, `hiring/routes/email-templates.tsx`, `hiring/routes/api.decisions.$id.release.ts`, `routes/portal.apply.tsx` — read `GmailIntegration` instead of `User.googleRefreshToken`.
- ~30 hiring routes — replace `prisma.dALIMember.findFirst({ where: { userId } })` patterns with direct User reads. Per a grep at start of this work: see `app/admin-console/routes/api.members.$memberId.roles.ts`, all `/hiring/routes/api.*` files.
- `app/admin-console/routes/admin-console.members.tsx`, `admin-console.domains.tsx` — `DALIMember.roles` editor removed; replace with `CoreAssignment` / `AdminMembership` UIs (or stub until Admin CRUD track ships).
- `app/types.ts:193,200` — drop `daliMemberId` fields.
- Tests — fixtures referencing `daliMemberId` / `DALIMember.firstName` updated.

## Verification checklist

### Staging dry-run

- [ ] Reset staging Neon from prod snapshot
- [ ] `npx prisma migrate deploy` applies M1–M4 cleanly
- [ ] Run smoke tests on staging:
  - [ ] CAS login → User row resolved
  - [ ] Google login → DALIMember row resolved
  - [ ] Domain Lead applications page lists all current-domain applications
  - [ ] Reviewer can submit a review (writes to `ApplicationReview.submittedByUserId`)
  - [ ] Interview can be scheduled / completed (Decision write path)
  - [ ] Delibs session opens (DelibsSession.openedByUserId)
  - [ ] Gmail send-as still sends (reads `GmailIntegration`)
  - [ ] Free-busy returns events for users with `UserCalendarLink` (legacy fallback removed; users without link return empty — confirm 0 admin users are affected)
- [ ] `SELECT COUNT(*) FROM "DALIMember" WHERE "userId" IS NULL` returns 0
- [ ] `SELECT COUNT(*) FROM "DomainLeadAssignment" WHERE "termId" IS NULL` returns 0
- [ ] `SELECT COUNT(*) FROM "CycleReviewer" WHERE "userId" IS NULL` returns 0 (and same for all 9 renamed tables)

### Production rollout

- [ ] Sign-off from cycle staff that 2026-S data is no longer being mutated
- [ ] Database backup taken via Neon point-in-time recovery snapshot (`Neon → Branches → New from prod`)
- [ ] Maintenance window scheduled (~30 min) for migration + smoke tests
- [ ] Deploy to prod via the standard Fly.io release command flow
- [ ] Post-deploy: re-run staging smoke checklist against prod
- [ ] Rollback plan: revert the Fly release; Neon snapshot can be restored within minutes if catastrophic

## Rollback notes

M1 (column adds) and M2 (orphan migration) are reversible — drop new columns and User rows respectively. M3 (backfills) is reversible by deleting CoreAssignment/AdminMembership rows created from backfill. M4 (drops) is **not** reversible without restoring from snapshot. The Neon snapshot taken pre-deploy is the rollback path for M4 failures.

If M4 fails partway, the migration is left in an inconsistent state. Do NOT attempt to hand-patch — restore from snapshot and re-run from scratch on staging to identify the failure.
