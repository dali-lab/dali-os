# DALI OS v0 Foundation Plan

Coordinated migration that unlocks parallel post-v0 track work. Authored after a Q&A pass on `expansion_plan.md` + `dali-os-mcp.md`. This doc captures the locked decisions; the source-of-truth for the schema is `dali-api/prisma/schema.prisma`.

## Constraint: a hiring cycle is live in production

The 2026-S hire cycle is `Open` / `UnderReview` while this lands. Migrations must be **additive only** during the cycle. Destructive changes (column drops, FK renames, NOT NULL tightening) are deferred to Phase 2 and run after the cycle closes — or coordinated with cycle staff on staging first.

## Two-phase split

| Phase | Scope | Live-cycle safe? | When |
|---|---|---|---|
| **1** | Add new tables. Add nullable columns. Backfill where data already exists. Seed Domain code/displayName, Term, JobCodeLookup, PageTemplate, MentorNoteTemplate. | Yes — purely additive | Now |
| **2** | Drop `User.googleAccessToken/RefreshToken/TokenExpiresAt`. Drop `DALIMember.firstName/lastName/daliEmail/dartmouthEmail/did/roles[]`. Rename hiring FKs `memberId/daliMemberId → userId` (9 tables). Tighten `NOT NULL`. Drop `MemberRole` enum. | No — modifies hot-path columns | After 2026-S cycle closes |

Feature tracks can start building against Phase 1 models the moment Phase 1 lands. They only depend on the **new** tables; the destructive parts of Phase 2 don't block them.

## Locked decisions (from Kiran's Q&A pass)

### Identity model

- **DALIMember** stays as a thin marker after Phase 2: `{ id, userId @unique (NOT NULL), createdAt, updatedAt }`. Membership semantic = "row exists." Auto-created on any `@dali.dartmouth.edu` Google sign-in (per MCP decision D-1).
- **`netId` = `did`**. They're the same Dartmouth identifier (case-normalized via lowercase). Keep `User.netId` column. Drop `DALIMember.did` in Phase 2; data backfills into `User.netId`.
- **All universal profile fields live on `User`**, accessed as `user.<field>`. No `user.daliMember.firstName` indirection.
- **PartnerUser.userId @unique → User**. Single Session model, shared middleware. PartnerUser carries org-scoped metadata (partnerOrgId, displayRole) and partner-only flags.
- **116 orphan DALIMember rows** (NULL userId, contact-info only) get migrated to User rows + linked DALIMember rows during Phase 2. After Phase 2 there are no orphans.

### User column changes

**Added in Phase 1 (all nullable):**
`classYear`, `graduatedAt`, `pronouns`, `photoUrl`, `bioDocId`, `major`, `hometown`, `linkedinUrl`, `githubUrl`, `personalSite`, `personalEmail`.
`timeZone` already exists.

**Dropped in Phase 2:** `googleAccessToken`, `googleRefreshToken`, `googleTokenExpiresAt`. Gmail send-as moves to new `GmailIntegration` model (added Phase 1). The legacy free-busy fallback in `lib/google-calendar.ts:fetchBusyFromLegacyUserTokens` is deleted in Phase 2 — it's only reachable for users with no `UserCalendarLink` AND Gmail-authorize tokens populated (today: ~1 admin account).

### Auth / OAuth separation

- `/auth/*` = website cookie sessions only. `/auth/callback/{google,cas}` issues `__dali_sid`.
- `/oauth/*` = MCP only. `/oauth/{authorize,callback/*,token,revoke,consent}` issues opaque session ids (also stored in `__dali_sid` after exchange).
- `/integrations/*` = token grants for external API access (calendar, gmail).
- New file split (Phase 1):
  - `lib/auth/cookie-login.ts` (was `lib/auth.ts`)
  - `lib/auth/oauth-provider.ts` (was `lib/oauth.ts`)
  - `lib/auth/session.ts` (unchanged)
  - `lib/auth/provisioning.ts` (was `lib/user-provisioning.ts`)
  - `lib/auth/linking.ts` (unchanged + adds CAS→Google merge)
- `OAuthClient`, `OAuthGrant`, `OneTimeToken` (magic-link) models added in Phase 1. No `dali-api` client seed — table stays empty until MCP foundation track seeds `claude-desktop` / `claude-code` rows.
- `upsertUserFromGoogle` collapses to **member-only** in Phase 2 (the `@dartmouth.edu` and partner branches are dead code post-Q14/Q11 confirmations). Partners auth through magic-link (Phase 1 has the model; Partner portal track builds the UI).

### Hiring FK renames (Phase 2)

Full sweep. Nine tables rename `memberId` / `daliMemberId` → `userId` and point at User:

- `DomainLeadAssignment.memberId` → `userId` (also adds `termId` Phase 1 nullable, Phase 2 NOT NULL with backfill to current term)
- `CycleReviewer.daliMemberId` → `userId`
- `CycleInterviewer.daliMemberId` → `userId`
- `Decision.madeById` → `userId`
- `ApplicationReview.submittedById` → `userId`
- `DelibsSession.openedById` → `userId`
- `LegacyEmailTemplate.createdById` → `userId`
- `EmailTemplateVersion.createdById` → `userId`
- `ConfidentialityAgreementVersion.createdById` → `userId`

`lib/roles.ts` gets rewritten same PR: `MemberRole[]` enum gone, helpers replaced per expansion_plan §"v0 Deliverables → §3."

### Tier resolution

```
tier(userId, term?) =
  has AdminMembership                    → Admin
  has CoreAssignment(term)               → Core (still Member-access)
  has DALIMember row:
    if setupComplete(userId) is false    → MemberPendingSetup
    else                                  → Member
  has PartnerUser row                     → Partner
  has any past assignments, no current:
    if before classYear graduation       → "on leave" (treat as Member tier with reduced surface)
    else                                  → Alumni
  has netId, no DALIMember, no PartnerUser → Student
  default                                  → Unknown (treated as logged-out)
```

`setupComplete(userId)`: `UserCalendarLink` row exists AND `classYear`, `pronouns`, `photoUrl` non-null. Derived, not stored.

`currentTerm()`: resolves now() against `Term.startDate/endDate`. Between terms → returns upcoming term (so a member doesn't briefly become Alumni).

### Notification reconciliation with PR #517

PR #517 (`sp/notifications`) is currently open and introduces a `Notification` model + `MeetingRsvp` enum + `ScheduledMeeting.organizerCalendarLinkId`. The expansion plan calls for `NotificationEvent` / `NotificationPreference`.

**Decision (pending Kiran's nod):** merge PR #517 first; v0 adopts its `Notification` as the canonical name, adds `NotificationPreference` alongside. If PR #517 doesn't land before this branch, v0 ships `NotificationEvent` and PR #517 rebases.

### Other locked answers

- `InstructorAssignment` unique → `[userId, offeringId, termId]` (a member instructing the same offering across two terms gets two rows).
- `MentorshipPair` unique loosened to allow multi-mentor: drop the unique entirely, keep `@@index([menteeUserId, projectId, termId])`.
- `Level <= DomainEligibility.level` check stays app-level (no DB constraint).
- `Project.firstTermId` NOT NULL on creation. New rows always set it.
- CAS→Google merge added to `lib/auth/linking.ts`: when an `@dali.dartmouth.edu` Google sign-in finds no daliEmail match but the chained CAS step returns a netId that matches an existing User, merge the User rows instead of creating a new one.

## Phase 1 deliverables (this branch)

1. **Schema additions** in `dali-api/prisma/schema.prisma`:
   - All ~40 new models from expansion_plan + MCP plan.
   - `User`: new nullable profile columns.
   - `Domain`: add `code String?`, `displayName String?`, `isInternProgram Boolean @default(false)`, `active Boolean @default(true)`. Existing `name` retained for transition; Phase 2 enforces NOT NULL on code/displayName and drops `name`.
   - `Application`: add `applicationType ApplicationType @default(Standard)`.
   - `DomainLeadAssignment`: add `termId String?` (nullable).
   - `Session.grantId`: add FK constraint to `OAuthGrant.id`.
   - `OAuthAccountType` enum: leave intact in Phase 1; Phase 2 collapses to `member`-only.

2. **Migration**: `npx prisma migrate dev --name v0_phase1_additive`. Single SQL file, no destructive operations. pgfence should be green.

3. **Seed**:
   - Local dev (`prisma/seed.ts`): the 3 existing domains get `code` + `displayName` populated. No change in dev test flow.
   - Production reference data (`prisma/seeds/v0-reference.ts`): run via `npm run db:seed:v0-reference` after `prisma migrate deploy`. Seeds the 17 domains from expansion_plan §"Initial Domain seed" (idempotent), 12 Term rows (26W–28F), `PageTemplate` rows (Empty, Project Brief, Sprint Retro, Sprint Goals, Meeting Notes, Decision Log, Onboarding Doc), and a default `MentorNoteTemplate`. `JobCodeLookup` is intentionally NOT seeded here — it needs real Dartmouth payroll mappings managed via Admin Console.

4. **No code changes** that depend on the new tables in Phase 1. `lib/auth/*` split + provisioning collapse happen in Phase 2.

5. **`emitEvent` producer stub** in `lib/notifications.ts` so feature tracks can emit from day 1. Delivery is its own track.

## Phase 2 deliverables (separate branch, after live cycle)

1. Backfill scripts:
   - Migrate `DALIMember` orphan rows → User + DALIMember pairs.
   - Backfill `DomainLeadAssignment.termId` to current term.
   - Backfill `MemberRole[]` → `CoreAssignment` (HiringLead) + `AdminMembership` (Admin) rows.
   - Backfill `DALIMember.did` → `User.netId` (case-normalize).
   - Backfill hiring-FK `userId` columns from `DALIMember.userId`.
   - Backfill `GmailIntegration` from `User.google*` for the 1–2 admin accounts.
   - Backfill `Domain.code` / `Domain.displayName` for any pre-Phase-1 rows missing them.

2. Drop columns:
   - `User.googleAccessToken`, `googleRefreshToken`, `googleTokenExpiresAt`
   - `DALIMember.firstName`, `lastName`, `daliEmail`, `dartmouthEmail`, `did`, `roles[]`
   - Old FK columns (`daliMemberId`, `memberId`, `madeById`, etc.) — keep new `userId` column.

3. Tighten constraints:
   - `DALIMember.userId` NOT NULL
   - `DomainLeadAssignment.termId` NOT NULL
   - `Domain.code`, `Domain.displayName` NOT NULL
   - Hiring FKs `userId` NOT NULL

4. Code refactor:
   - `lib/roles.ts` rewritten.
   - `lib/auth/*` file split.
   - `upsertUserFromGoogle` collapsed to member-only branch.
   - All `prisma.dALIMember.findFirst({ where: { userId } })` calls in ~30 hiring routes replaced with direct User reads.
   - `MemberRole` enum dropped.
   - `OAuthAccountType` enum collapsed to `member`-only.
   - Legacy `fetchBusyFromLegacyUserTokens` deleted.
   - Gmail send-as code (interview-emails.ts, extension-notice.ts, etc.) reads `GmailIntegration` instead of `User.google*`.

5. Drop legacy:
   - `MemberRole` enum.
   - Test fixtures referencing `daliMemberId`.

## Deploy sequencing

| Step | Branch | Target | Notes |
|---|---|---|---|
| 1 | `v0-phase1-additive` | `dev` then `staging` then `prod` | Additive only. Live cycle unaffected. |
| 2 | (feature tracks fork from here) | various | Parallel work. Build against new models. |
| 3 | `v0-phase2-identity-refactor` | dev/staging first; **wait for cycle close** before prod | Destructive. Run backfills on staging; verify hiring routes still work end-to-end against the cycle data clone. |

## Staging verification checklist (Phase 1)

Run **before** merging Phase 1 to dev:

- [ ] `npx prisma migrate dev` applies cleanly on a fresh DB
- [ ] `npm run typecheck` green
- [ ] `npm test` green (Vitest)
- [ ] `npm run test:e2e` green (Playwright)
- [ ] `migration-check.yml` (pgfence) green on the PR
- [ ] Manual: dev seed runs; new tables empty as expected; existing data untouched
- [ ] Manual: hiring routes still work against seeded cycle (no schema-driven regressions)

## Staging verification checklist (Phase 2)

Pre-merge gate (after cycle close):

- [ ] Phase 1 already in prod
- [ ] 2026-S cycle status = `Completed`
- [ ] Staging Neon branch restored from prod snapshot
- [ ] Backfill scripts dry-run on staging — counts match expectations
- [ ] Apply Phase 2 migration on staging — `prisma migrate deploy` succeeds
- [ ] Run hiring route smoke tests on staging against migrated data
- [ ] Run new track integration tests
- [ ] Sign-off from cycle staff that hiring data isn't needed in old shape
- [ ] Roll forward to prod
