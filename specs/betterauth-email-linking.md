# BetterAuth — email backfill & account linking

Status: spec (2026-09-24). Owner: auth migration. Sibling to
[betterauth-migration.md](./betterauth-migration.md). Behind the `betterauth`
flag (OFF). Nothing here is applied to prod yet.

## Why this exists

Two problems share one lever:

1. **Cutover blocker.** BetterAuth resolves every login by a single canonical
   `email` column (`internalAdapter.findUserByEmail(email)`, confirmed in
   `better-auth/dist/plugins/email-otp/routes.mjs`). Legacy members were created
   by `upsertUserFromGoogle`, which upserts on `daliEmail` and **never sets
   `email`** — so they have `email = null` and **cannot log in passwordless at
   all** until it is backfilled.
2. **Phantom / duplicate identities.** A DALI member *is* a Dartmouth student:
   they control both `@dali.dartmouth.edu` and their `netid@dartmouth.edu`
   inbox. We want one person → one account, reachable by either address — "the
   same as if they used their dali one." We do **not** want a member ending up
   with a separate lower-trust `@dartmouth` account, and we do not want a
   member's `@dartmouth` sign-in to spawn a fresh student row.

The backfill is where both are solved: it gives every real person exactly one
row with a canonical `email` set and all of their known addresses recorded on
that row.

## Identity model (the invariant we are backfilling toward)

- **One `User` row per human.** All of their addresses live on that row:
  `email` (canonical login id), `daliEmail`, `dartmouthEmail`, `personalEmail`,
  plus `netId`. Every one of these is `String? @unique`.
- **Canonical `email` is the login identifier.** Chosen per the rules below.
- **Membership is a row, not a string.** Authorization comes from `DALIMember`
  / `isCore` / eligibility rows — never from the derived `type`
  (member/dartmouth/partner) or the login door. `deriveType` is a display/route
  hint only; the login loader already routes on the `DALIMember` row, not
  `type`. (Enforcing this everywhere is the separate type-as-authz audit, #3.)
- **Alias sign-in** (piece #2, separate PR): `/login` matches the typed address
  against all of the row's recorded emails, runs the OTP against the canonical
  `email`, and treats an unknown address as a neutral no-op. An address only
  resolves to a row if it is **already recorded on that row** — so a stranger's
  address can never resolve to your account.

## Canonical `email` selection

Priority, first non-null wins (unchanged from the existing script, and it
matches "their dali one"):

```
canonical = daliEmail ?? dartmouthEmail ?? personalEmail
```

- Members with a `@dali` address log in with `@dali`; their `@dartmouth` stays
  on the row as an alias so it *also* works once the alias resolver ships.
- Accepted-applicant members who have no `@dali` yet (their row was reused by
  `promoteToMember`, which does not mint a `@dali` address) log in with their
  `@dartmouth` canonical. Consistent: it is still their one account.
- Rows with all email columns null keep `email = null` (nullable) and simply
  cannot log in until an address is added — reported, never guessed.

## What the current script already does

`prisma/scripts/backfill-betterauth-email.ts` (dry-run by default,
`--apply` to write):

- Sets `email = canonical` where `email IS NULL` and not a collision.
- Sets `name` from `firstName + lastName` where `name = ''`.
- Flips `emailVerified = true` for backfilled rows (they pre-date BetterAuth and
  were already verified via Google/CAS).
- Detects **same-email collisions** (two *different* rows resolving to the same
  canonical email), skips them, and aborts `--apply` unless
  `--force-skip-collisions`.
- Idempotent, batched (500), safe to re-run.

## Gaps this spec adds

### G1. Same-person, *different*-email duplicates (the real phantom case)

The current collision detector only catches two rows with the **same** canonical
email. The phantom case is two rows with **different** emails that are the same
human — e.g. an applicant row (`dartmouthEmail`/`netId`) and a separate member
row (`daliEmail`) that the legacy Google↔CAS merge never joined. These slip
through as two accounts.

**Detection, by descending confidence:**

1. **Shared `netId`** — impossible under the unique constraint, so if two rows
   *do* both carry a netId they are already distinct people; not a duplicate.
   The join therefore keys off netId being present on **one** row and the other
   row being the same person by a second signal:
2. **`netId` ⇄ directory email.** For a member row with `daliEmail` but no
   `dartmouthEmail`/`netId`, resolve their Dartmouth identity via
   `peopleByNetId` / `bindNetIdByEmail`; if the resolved `@dartmouth` address
   or netId matches another row, they are the same person → **merge candidate**.
3. **Exact name + overlapping identity** with nothing contradicting — **flag for
   Core review, do not auto-merge.** Name-only is never sufficient to merge
   (two real people can share a name); it only produces a report.

**Policy:** auto-merge only tier-2 (a strong, directory-confirmed identity
link). Everything weaker is a report the run prints and a human resolves. Silent
name-based merges are forbidden.

### G2. Merge procedure

Model it on `app/lib/linking.ts` (`linkCasToGoogleUser`), which is the existing,
tested template: pick a **survivor** row, re-parent the duplicate's rows to it,
copy over any addresses the survivor lacks, then delete the duplicate.

- **Survivor = the row with the most accumulated data** (heuristic: has
  `DALIMember`, or the older `createdAt`). The duplicate should be the thin one.
- **Re-parent** every FK'd relation from duplicate → survivor. This is a large
  surface (sessions, tasks, notes, assignments, notifications, …), so the safe
  version merges **only when the duplicate is a husk** (no accumulated data
  beyond auth/session/marker rows) — exactly the constraint `linkCasToGoogleUser`
  already relies on. Two rows that *both* carry real work are a **manual** merge,
  flagged, not automated here.
- **Absorb addresses:** copy `daliEmail`/`dartmouthEmail`/`personalEmail`/`netId`
  onto the survivor where the survivor's column is null and the value is free.
- Recompute the survivor's canonical `email` after absorbing.

### G3. Alias population (so `@dartmouth` login works for `@dali` members) — operational, not code

Decision (Kiran, 2026-09-25): populate `dartmouthEmail` on member rows
**operationally**, not via a directory lookup or an onboarding-capture step.

- **Existing members:** a one-time backfill (Kiran) writes each member's
  `@dartmouth` address. Not a directory guess — the directory only resolves by
  *name* (`searchDirectoryByName`), with no clean `netId → email`, which is too
  weak to write into a `@unique` column unattended.
- **Future members:** captured by the application funnel. An applicant verifies
  their `@dartmouth` at Dartmouth-door signup and `captureDartmouthIdentity`
  writes `dartmouthEmail`; `promoteToMember` reuses that same row on hire, so the
  address is present before promotion.

Consequence: the login alias-resolver (#2) may assume `dartmouthEmail` is present
on member rows — no lazy proof-of-inbox capture required.

**Gap to close for "all future via hiring":** the manual add/promote path
(`promoteToMember` from the `/members` directory) attaches only a `DALIMember`
marker and captures no email, so a hand-added member (never went through a cycle)
gets no `dartmouthEmail`. Either route all member creation through the funnel, or
have the manual-add path require the `@dartmouth` address. Follow-up.

To support the one-time backfill, this script's dry-run reports member rows
(`daliEmail` set) that are **missing a `dartmouthEmail`** — the exact set Kiran
needs to cover.

## Safety & sequencing

- **Staging first.** Staging Neon is rebuilt from a prod snapshot each deploy,
  so a dry-run there reflects real prod data. Run dry-run, read the collision +
  duplicate + no-email reports, resolve flags, then `--apply` on staging.
- **Dry-run is the default;** `--apply` writes; merges require an explicit
  `--merge` gate (separate from `--force-skip-collisions`) so consolidation
  never happens by accident.
- **Idempotent & re-runnable.** Only touches `email IS NULL` / `name = ''` /
  `emailVerified = false` rows and free unique columns; a second run is a no-op.
- **Prod** runs once as part of cutover, immediately before the flag flip, from
  the same snapshot the staging run validated.
- **No migration file.** This is a data backfill script, not a schema change.

## Post-conditions to validate

After `--apply` on staging:

1. Every `DALIMember` has a non-null canonical `email`. (Query: members with
   `email IS NULL` → must be 0, else they can't log in.)
2. No two rows share a person by directory-confirmed netId.
3. Every backfilled row has `emailVerified = true`.
4. Spot-check: a member with both `daliEmail` and `dartmouthEmail` has canonical
   `= daliEmail` and the `@dartmouth` still recorded on the same row.
5. The no-email report is empty or entirely explainable (husk/partner rows with
   no address yet).

## #2 — Login alias resolver (implemented here)

`/login` now maps any address on a person's row to their canonical login email
before sending the code:

- `resolveLoginIdentifier(typed)` looks up a user by `email` / `daliEmail` /
  `dartmouthEmail` / `personalEmail` and returns their canonical `email`; an
  unknown address falls through unchanged → a neutral emailOTP no-op, so nothing
  is revealed.
- The code is delivered to the **canonical** (`@dali`) inbox; the screen keeps
  displaying the **typed** address (a hidden `identifier` carries the canonical
  to the verify step) so a member's `@dartmouth` → `@dali` mapping never leaks,
  even on a wrong-code retry.

`/signup` gained a **duplicate guard**: on the member/dartmouth doors, if the
entered address (or any alias) already belongs to an account, it signs them into
their canonical email instead of sending a signup link — so a member's
`@dartmouth` can never spawn a separate student row. Response stays neutral
(anti-enumeration).

Manual member creation (`/members` add) gained an **optional `@dartmouth`
field** so a hand-added member's alias is captured at creation (with a
uniqueness guard), closing the manual-add gap noted in G3.

## #3 — Type-as-authorization audit (findings)

Swept every read of the derived `type` (member/dartmouth/partner) and login
door. 46 sites; the principle: **authorization must read membership/role rows
(`DALIMember`, `isCore`, `AdminMembership`, `PartnerContact`, eligibility), never
the derived `type` or the door.** Findings:

- **Fixed here — `app/jobs/routes/internal.jobs.tick.ts`:** dropped the
  `type === "applicant"` pre-guard; `isAdmin()` (AdminMembership row) is the
  authoritative gate and the type check would wrongly reject a mis-typed admin.
- **Documented, not changed (routing with a row-gate behind it):**
  - `partners/lib/partner-auth.server.ts` (`requirePartnerAccount` /
    `requirePartnerCandidate`) redirects `type === "member"`/`"dartmouth"` before
    the `PartnerContact`/`DALIMember` checks. This is **documented, deliberate
    routing** (the residual-bucket comment), and the row checks are the real
    gate. Real but narrow edge: a person who is both a member and a partner
    contact gets bounced. Needs a product call before changing routing.
  - `education/lib/access.server.ts` + `education/routes/education.$offeringId.tsx`
    route member-shell vs portal by `type` alongside an `isManager` row check.
    The row check is authoritative; the `type` branch is a routing convenience.
    Tied to the education-redesign flags — change with care.
  - `calendar/routes/api.scheduled-meetings.ts` gates meeting creation on
    `type === "applicant"` — under BetterAuth `type` is never "applicant", so the
    guard is dead; the correct gate is a project-membership/role row. Follow-up.
  - Numerous `portal.*` / `hiring.*` / `layout.tsx` redirects key landing pages
    on `type` — routing hints, safe as long as their loaders gate data on rows
    (spot-checks held). Left as-is.

Net: no data-access privilege gates on `type` remain in scope; the flagged items
are routing redirects backed by authoritative row checks. The `type` string
stays a display/routing hint, as intended.

## Decisions (Kiran, 2026-09-24)

1. **Merge aggressiveness → auto-merge.** Auto-merge duplicates where the
   duplicate is a **husk** (auth/session rows only — nothing real re-parented),
   verified transactionally so any surprise dependent row rolls the merge back
   and flags it. Reliable same-address duplicates are merged; the directory-only
   applicant⇄member case (shares no address) is **detected and flagged**, not
   auto-merged, since confirming it requires the directory and the risk is
   higher. Two-real-data rows are always flagged.
2. **Alias delivery → `@dali`.** When a member types `@dartmouth`, the login
   resolver (piece #2) maps to their canonical `@dali` and sends the code there.
   No custom BetterAuth adapter. Copy stays generic so the mapping isn't
   revealed.
3. **Canonical for dual-address members → `@dali` first.** `daliEmail ??
   dartmouthEmail ?? personalEmail`. It's the address members know as their
   login and it persists through their tenure.

Implemented in `prisma/scripts/backfill-betterauth-email.ts` (pure decision
logic + tests in `app/lib/betterauth-linking.ts`).
