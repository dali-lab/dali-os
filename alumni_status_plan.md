# Membership Status — Implementation Plan

Supersedes the derivation approach in PRs #737 / #739 (`alumni_plan.md`). Reuses
#737's Dartmouth sync clients; replaces #739's per-call `isAlumni()` derivation
with a **stored, transition-computed status field**.

## Goal

An authoritative record of each lab member's status (`Active` / `Alumni`) that:

- is read O(1) on hot paths (one indexed column — no derivation, no external
  call, no latency in `getUserRoles`/`tier`);
- is recomputed only when an input can actually change it (transitions cluster:
  ~95% at June Commencement, ~5% at off-cycle term ends);
- is **decoupled from engagement tables** (`ProjectAssignment`,
  `ExternalMentor`, `StaffingMentorRole`, …) so that (a) an alumnus mentoring a
  project stays `Alumni`, and (b) the algorithm is immune to the ongoing churn
  in the staffing/mentor schema;
- is human-overridable for the cases no signal can resolve.

## Design principles (from review)

1. **Status is a fact about the person (enrollment + graduation), not about
   their current assignments.** Never infer `Active`/`Alumni` from assignment or
   mentor rows. This fixes the alumni-mentor case and insulates us from the
   staffing schema still being in flux.
2. **Store the answer; recompute at transitions.** Per-call derivation is wasted
   compute + latency for a value that changes ~once/year per person.
3. **Fetch authoritative signals at the boundary, not on a rolling window.** The
   7-day/14-day freshness windows in #737/#739 existed only to keep a cache warm
   enough for per-call reads. With a stored value refreshed by the Commencement
   sweep + login, there is no window to tune.
4. **Name the unresolvable case honestly and hand it to a human.** Dartmouth's
   `Alum + Student` is identical for a fresh grad (Student lingers) and a BE
   dual-degree candidate (genuinely enrolled). Don't guess with a time
   heuristic — pin the rare exceptions via the override.

## Data model — `schema.prisma`

```prisma
enum MembershipStatus {
  Active
  Alumni
}

model User {
  // ── Membership status (authoritative, stored) ──────────────────────────
  membershipStatus           MembershipStatus  @default(Active)
  // Manual pin. When set, wins over recompute and is never clobbered.
  // Handles: BE dual-degree candidates (Active while enrolled), non-student
  // staff members (never graduate), and any misclassification.
  membershipStatusOverride   MembershipStatus?
  membershipStatusComputedAt DateTime?         // observability only

  // ── Dartmouth directory signals (cached inputs) — from #737 ─────────────
  dartmouthAffiliation    String?   // raw IDM code: "DART" | "ALUMNI" | …
  dartmouthIsAlum         Boolean?  // "Alum" ∈ affiliations — degree conferred
  dartmouthIsStudent      Boolean?  // "Student" ∈ affiliations (lingers post-grad)
  dartmouthPeopleSyncedAt DateTime?
}
```

`membershipStatus` is only meaningful when a `DALIMember` row is present;
non-members keep the inert `Active` default. Consumers gate on `DALIMember`
first (the directory and `tier()` already do).

Migration: additive `ADD COLUMN` (one enum type + 3 columns on User + 4 cache
columns). **Date it after the latest applied migration** (currently
`20260720190000`) — do NOT reuse #737's `20260601120000` stamp, which now sorts
before ~15 applied July migrations.

## The recompute algorithm

```
recomputeMembershipStatus(userId):
  load { membershipStatusOverride, dartmouthIsAlum, dartmouthIsStudent,
         dartmouthAffiliation, graduatedAt, classYear, daliMember? }
  if no daliMember: return                      // status is member-only

  status =
    override                                   // manual pin wins
    ?? Alumni  if dartmouthIsAlum || dartmouthAffiliation == "ALUMNI"   // degree conferred
    ?? Alumni  if graduatedAt != null && graduatedAt < now             // off-cycle / manual input
    ?? Active  if dartmouthIsStudent === true    // authoritative still-enrolled (+1 guard, beats classYear)
    ?? Alumni  if classYear != null && commencement(classYear) <= now  // no-API fallback
    ?? Active

  write only if changed: membershipStatus = status, membershipStatusComputedAt = now
```

- **No engagement tables are read.** Alumni-mentor case handled by construction.
- **No freshness window.** The recompute is always *triggered by* a fresh sync
  (Commencement sweep / login refresh) or a DB-only input change, so the signals
  it reads are current by construction; between transitions the stored value
  simply persists (correct — status doesn't change between transitions).
- `commencement(classYear)` = June 15 of that year (conservative; Commencement
  is mid-June).
- BE dual-degree `Alum + Student`: default lands `Alumni` on the Alum branch;
  the ~handful of genuine BE candidates get `override = Active`.
- `graduatedAt` stays a **manual input** — the refresh does NOT auto-stamp it
  (dropped from #737's orchestrator). `membershipStatus` is now the stored
  graduation record, so auto-stamping is redundant and its stickiness bug goes
  away.

## Triggers (replace per-call derivation)

| Trigger | Action | Cadence / cost |
|---|---|---|
| **Term-rollover API sweep** (job runner) | on each term change — detected when `currentTerm()` differs from the `lastSweptTermId` held in job state — force-refresh Dartmouth signals for **all active members with a netId**, then recompute. June Commencement is just the highest-volume instance; off-cycle grads at every other term boundary (F/W/X ends) flow through the same path. Not keyed on `classYear == currentYear` (that misses +1s / off-by-one classYears); the whole active lab (~150) is cheap | ~1 min × ~4/yr |
| **Daily ambiguous-set re-sync** (job runner) | re-pull Dartmouth for the small set that *looks still-enrolled but whose class has graduated*: `Active`, netId present, classYear commencement passed, currently `Student ∧ ¬Alum`. **Self-terminating** — a grace-period grad leaves the set the day "Alum" posts (→ `Alumni`); a genuine +1 correctly stays `Active`. Carries the graduating cohort through the multi-week window where "Alum" lands "within weeks", with no date heuristic | daily, ~tens shrinking to ~few |
| **Daily recompute pass** (job runner, DB-only) | recompute all members from already-cached signals — applies the formula as the clock advances (classYear / `graduatedAt` crossings), zero API cost | daily, ~hundreds of rows |
| **Login** (CAS + Google callbacks) | fire-and-forget: `refreshDartmouthSignals` → `recomputeMembershipStatus`; throttled to ≤ once/day/user | per sign-in |
| **Mutation hooks** | `DALIMember` created → `Active`; `graduatedAt` edited → recompute; override set → recompute | per-event |

We do **NOT** refresh on shell/layout load (the #739 behavior) — the stored
value removes any need to keep a cache warm for reads, and keeps the hot path
side-effect-free.

**Why term-rollover, not a fixed June date.** Transitions cluster at *term
boundaries*, of which Commencement is one; keying the sweep to `currentTerm()`
changing handles every term end via one code path with no calendar constant to
drift. The one wrinkle — a fresh grad swept the instant Spring ends can still
show lingering `Student` before "Alum" posts, and would read `Active` — is
resolved by the daily ambiguous-set re-sync, which *waits for the authoritative
`Alum` signal* instead of guessing with a grace-period timeout. That same
mechanism is what cleanly separates a grace-period grad (Alum eventually posts →
`Alumni`) from a genuine +1 (Alum won't post for a year → stays `Active`).

All behaviors live as one registry entry (idempotent, bounded under the lease);
it persists `lastSweptTermId` in job settings so the full sweep fires once per
rollover. See `app/jobs/registry.ts`.

## What we reuse from #737 / #739

**Reuse ~as-is (from #737):**
- `app/lib/dartmouth-jwt.ts` — cached JWT exchanger. Clean, no changes needed.
- `app/lib/dartmouth-people.ts` — People client + `parseDepartmentClass`. As-is.
- The 4 cache columns + `.env.example` `DARTMOUTH_API_KEY`.
- Login-callback wiring (resolve the one trivial import-order conflict in
  `auth.callback.google.ts`).

**Rework (from #737):**
- `app/lib/dartmouth-refresh.ts` — strip the `graduatedAt` auto-stamp and the
  `staleAfterDays` trust-window logic; it now just fetches + writes cache
  columns. Callers chain `recomputeMembershipStatus`.

**Replace (from #739):**
- `isAlumni()` 5-tier per-call derivation → `recomputeMembershipStatus()` +
  stored field. `getUserRoles` reads `membershipStatus` and exposes
  `isAlumni: status === 'Alumni'` (informational only — access suppression and
  the alumni sidebar/route-guards are **deferred**, see below).
- `tier()` resolver kept, but composes cheap record checks
  (`isAdmin`/`isCore`/`PartnerUser`/`DALIMember`) with the **stored** status
  instead of re-deriving. Unused on staging today; ships ready.

**Directory (from #739, simplified):**
- `members.tsx` `?status=alumni` tab → `where: { daliMember: { isNot: null },
  membershipStatus: 'Alumni' }`, class-year sort. The forgiving
  `alumniWhereClause` and its Tier-0 inconsistency are gone — the stored field
  is the single source of truth, so the tab and the status agree by
  construction.

## Deferred to a follow-up (per scope decision)

- Alumni **sidebar variant** (Home / People / Profile only).
- **`ALUMNI_DENIED_PREFIXES` route guards** + the `getUserRoles` access
  suppression (`isLabMember`/`isDomainLead`/`isInstructor`/`canViewForms` for
  pure alumni). Landing these together with the sidebar keeps the access change
  coherent and testable in one pass.
- `OnLeave` status value (manual-only; add when needed).

## Migration / CI notes

- One additive migration, re-dated after `20260720190000`. `migration-check.yml`
  should pass (no drift, no deletions, `ADD COLUMN` is pgfence-safe).
- Backfill: after deploy, run the sweep once (Admin → Jobs → Run-now, or the
  daily pass) to populate `membershipStatus` for existing graduated members —
  the column default leaves them `Active` until first recompute.
- `DARTMOUTH_API_KEY` must be a Fly secret in staging + prod before the sweep /
  login refresh does anything (unset → refresh no-ops → status falls back to
  `graduatedAt` + classYear math, which still works).
- Every mocked `getUserRoles` in tests gains `isAlumni: false` (there are a few
  beyond #739's `analytics.test.ts`).

## Test plan

- Unit: `recomputeMembershipStatus` truth table — override wins; Alum→Alumni;
  graduatedAt→Alumni; Student(¬Alum)→Active beats a lapsed classYear; classYear
  fallback with no signals; non-member no-op; alumni-with-current-assignment
  stays Alumni (decoupling proof).
- Reuse #737's JWT + People client tests as-is.
- Directory: Alumni tab returns only `membershipStatus == Alumni` members.
- Job: sweep is idempotent, bounded, date-gates the API pass.

## Known limitations

- **BE dual-degree candidate** (`Alum + Student`): defaults to `Alumni`; requires
  a manual `override = Active` until they finish. Rare; honest.
- **+1 student with no netId and no logins**: no Dartmouth data → classYear
  fallback may read `Alumni` a year early. The annual sweep covers anyone with a
  netId; a truly netId-less +1 who never logs in is the only gap — override
  fixes it.
