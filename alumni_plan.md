# Alumni Accounts — Plan

## Goal

Graduating seniors keep their accounts and get an alumni-appropriate experience. Other members find alumni in a directory. The system uses Dartmouth's APIs as the source of truth so this **keeps working year after year** without manual intervention as each class graduates.

## What we already have

- `User.classYear` (Int?) — populated from Notion import for current members
- `User.graduatedAt` (DateTime?) — off-cycle graduation override
- `User.netId` (String?) — set on CAS sign-in, primary key for Dartmouth API lookups
- Past `ProjectAssignment` history per user
- `User.daliEmail` persists 10+ years → no auth changes needed
- Profile editor at `/members/$id` already supports relevant fields

## The two Dartmouth APIs

| API | Auth | Coverage | Role |
|---|---|---|---|
| `lookup.dartmouth.edu/api/search` | Public (Referer header) | **Currently affiliated only** | Source of truth for "still a student" |
| `api.dartmouth.edu/api/people/{netid}` | JWT (exchanged from existing API key) | All accounts including alumni | Source of truth for "officially alumni" |

Both ship in v1 — we already have a Dartmouth API key.

### People API JWT exchange

```
POST https://api.dartmouth.edu/api/jwt
Headers:  Authorization: {DARTMOUTH_API_KEY}    (raw key, no "Bearer" prefix)
```

Response: `{ jwt, payload: { exp, ... }, accepted_scopes }`. No optional scope is requested: `dartmouth_affiliation` (the only field we read) is in the base no-scope People payload, and the optional scopes (`private` / `read.sensitive` / `read.highlysensitive`) gate FERPA/sensitive fields that require data-steward approvals we don't need.

JWT expiration is ~6 hours (per sample payload `exp - iat ≈ 21600s`). Cache in process memory; re-fetch when within 5 minutes of expiry. No DB persistence — process restarts just re-exchange the key. One env var: `DARTMOUTH_API_KEY`.

Subsequent People API calls use `Authorization: Bearer {jwt}`.

## What to build

### 1. Schema additions — `dali-api/prisma/schema.prisma`

Add to `User` (single migration):

```prisma
// lookup.dartmouth.edu cache
dartmouthLookupAffiliation String?    // "Student" | "Staff" | "Faculty" | null=absent-from-lookup
dartmouthLookupSyncedAt    DateTime?

// api.dartmouth.edu/people cache (populated once OAuth lands)
dartmouthAffiliation       String?    // "ALUMNI" | "DART" | "E-FAC" | ...
dartmouthPeopleSyncedAt    DateTime?
```

No other schema changes. Existing `classYear`, `graduatedAt`, `personalEmail` cover the rest.

### 2. API client — `dali-api/app/lib/`

Flat-named modules, all `dartmouth-` prefixed to disambiguate from session JWT machinery in `auth.ts`:

- `dartmouth-lookup.ts` — `lookupByNetId(netId)`: GET `lookup.dartmouth.edu/api/search?query={netId}` with Referer header. Returns `{ affiliation, classYear? }` or null. Parses `dcDeptclass: "'27"` → `2027`.
- `dartmouth-people.ts` — `peopleByNetId(netId)`: GET `api.dartmouth.edu/api/people/{netid}` with `Authorization: Bearer {jwt}`. Returns `{ dartmouthAffiliation }`.
- `dartmouth-jwt.ts` — `getDartmouthJwt()`: cached JWT exchanger. POSTs to `/api/jwt` with API key (no optional scope), caches in memory until 5 min before `exp`. All People calls go through this.

Single shared helper `refreshDartmouthSignals(userId, { staleAfterDays })` in `dartmouth-refresh.ts`:
- Skip if `*SyncedAt` is fresher than threshold
- Call both APIs in parallel
- Write cache columns; never overwrite an existing `classYear` (let user input win)
- Auto-set `graduatedAt = now()` on first transition to `ALUMNI`

### 3. `isAlumni` derivation — `dali-api/app/lib/roles.ts`

Layered, most-authoritative first:

```ts
isAlumni(user) =
  dartmouthAffiliation == "ALUMNI"                                 // Tier 1: People API
  OR graduatedAt < now()                                           // Tier 2: explicit override
  OR (dartmouthLookupAffiliation == "Student" AND fresh) → false   // Tier 3: lookup negative override
  OR (classYear < currentYear AND no current-term assignments)     // Tier 4: derivation fallback
```

Tier 3 is the negative override that protects 5th-year seniors: if lookup still lists them as a Student, they are not alumni regardless of what `classYear` math says.

Also:
- Add `isAlumni: boolean` to `getUserRoles()` return
- Tweak `isLabMember`: `has DALIMember AND NOT isAlumni`
- Add `tier(userId, term)` resolver returning `Admin | Core | Member | Alumni | Student | Partner` (expansion_plan.md §347)

### 4. Sync triggers — lazy, not cron-driven

Three triggers, no nightly job:

- **On CAS sign-in**: if `dartmouthLookupSyncedAt` is null or > 30 days old, refresh inline (~200ms). Catches grads the next time they log in.
- **On Core viewing a member profile**: same staleness check, refresh in the background.
- **Annual Commencement sweep**: a scheduled task firing June 15 each year that refreshes every `User` with `netId IS NOT NULL` and `classYear == currentYear`. ~30 calls, ~1 minute. Captures the graduating class regardless of whether they've logged in yet.

This keeps working forever: every class hits the Commencement sweep the year they graduate, and any straggler whose status changes off-cycle gets caught next time they log in.

### 5. Alumni sidebar + route guards

Sidebar variant for alumni: **Home**, **People**, **Profile**. Hide Projects, Calendar, Mentorship, Hiring, Core, Admin.

Route guards (deny → redirect to `/`):
- `/projects/*`, `/calendar`, `/mentorship/*`, `/hiring/*`, `/core/*`, `/admin-console/*`, `/staffing/*`

Allow:
- `/`, `/profile`, `/members/$id`, `/people`

### 6. Alumni directory — `dali-api/app/routes/people.tsx`

- "Alumni" tab next to "Current"
- Class year filter, search by name
- Card click → existing `/members/$id` (read-only for non-self)
- Past project history rendered from existing `ProjectAssignment` rows

## What we're NOT building yet

- **Magic-link auth on `personalEmail`** — dali emails persist 10+ years, no urgency
- **Coffee-chat opt-in flag, newsletter feed** — wait for real demand
- **Transition notifications / audit log** — `NotificationEvent` model from v0 can carry this when needed; not v1
- **Profile-completion banners** — Notion data is good enough for the 2026 cohort; revisit if data gaps appear

## Edge cases handled

| Case | Outcome |
|---|---|
| Class of 2026 graduates June 2026 | Commencement sweep → lookup absent + (eventually) People says ALUMNI → Tier 1 |
| 5th-year senior (classYear=2025, still has current assignment) | Tier 3 lookup-says-Student wins → not alumni |
| On-leave member | classYear in future → Tier 4 returns false → not alumni |
| Off-cycle grad | Set `graduatedAt` manually → Tier 2 |
| Lookup down for a week | `fresh` check fails on Tier 3 → falls through to Tier 4 → still works |
| Member with no netId | No API sync possible → Tier 4 (classYear math) |
| Member graduates but stays on as Dartmouth staff | Lookup says Staff → Tier 3 doesn't fire → Tier 4 → alumni of DALI |
| Dartmouth API key invalid / JWT exchange fails | `getJwt()` throws; People call short-circuits to null → Tier 1 silently doesn't fire → other tiers still work |

## Files touched

- `dali-api/prisma/schema.prisma` (+ migration) — 4 new cache columns on User
- `dali-api/app/lib/dartmouth-lookup.ts` (new) — lookup client
- `dali-api/app/lib/dartmouth-people.ts` (new) — People client
- `dali-api/app/lib/dartmouth-jwt.ts` (new) — JWT exchange + in-memory cache
- `dali-api/app/lib/dartmouth-refresh.ts` (new) — `refreshDartmouthSignals()` orchestrator
- `dali-api/.env.example` — add `DARTMOUTH_API_KEY`
- `dali-api/app/lib/roles.ts` — `isAlumni`, `tier`, update `getUserRoles`, tweak `isLabMember`
- `dali-api/app/lib/terms.ts` (or similar) — `currentYear()` helper
- CAS callback handler — call `refreshDartmouthSignals` on sign-in
- Core member-profile loader — background refresh call
- Scheduled task config — annual June 15 Commencement sweep
- Sidebar component — alumni layout branch
- Layout / route guard middleware — adjust allowed routes per tier
- `dali-api/app/routes/people.tsx` — Alumni tab + class year filter

## Sequencing

1. **PR 1** — Schema migration + Dartmouth API clients + `refreshDartmouthSignals` + CAS hook
2. **PR 2** — `roles.ts` derivation (Tier 1-4) + `tier` resolver + tests
3. **PR 3** — Sidebar variant + route guards
4. **PR 4** — Alumni directory tab on `/people`
5. **PR 5** — Annual Commencement sweep scheduled task

PRs 1-2 must land before Commencement (~June 14, 2026). PRs 3-5 can land in the week after.

**Prereq**: `DARTMOUTH_API_KEY` set in Fly secrets for staging + prod before PR 1 deploys.

## When to revisit

- If `personalEmail` becomes load-bearing (dali emails actually start expiring) → build magic-link auth
- If alumni ask for active contribution paths (remote mentoring, app review) → design that, not before
- If lookup API rate-limits us → add a small request queue; don't preemptively
