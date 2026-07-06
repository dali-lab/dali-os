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

## The Dartmouth API (singular)

> **History**: v1 of this plan used two APIs — public `lookup.dartmouth.edu`
> as the "still a student" source and the People API for "officially alumni."
> As of July 2026, `lookup.dartmouth.edu` is behind Dartmouth SSO (even
> `GET /` 302s to `saml2/authenticate`), so it is unreachable from our
> servers. Everything now derives from the People API, which turns out to
> carry all three signals anyway.

| API | Auth | Coverage | Role |
|---|---|---|---|
| `api.dartmouth.edu/api/people/{netid}` | JWT (exchanged from existing API key) | All accounts including alumni | Sole source: graduation, enrollment, class year |

### People API JWT exchange

```
POST https://api.dartmouth.edu/api/jwt
Headers:  Authorization: {DARTMOUTH_API_KEY}    (raw key, no "Bearer" prefix)
```

Response: `{ jwt, payload: { exp, ... }, accepted_scopes }`. No optional scope is requested: everything we read is in the base no-scope People payload, and the optional scopes (`private` / `read.sensitive` / `read.highlysensitive`) gate FERPA/sensitive fields that require data-steward approvals we don't need.

JWT expiration is ~6 hours. Cache in process memory; re-fetch when within 5 minutes of expiry. No DB persistence — process restarts just re-exchange the key. One env var: `DARTMOUTH_API_KEY`.

Subsequent People API calls use `Authorization: Bearer {jwt}`.

### Observed API behavior (live records, 2026-07-06, three weeks post-Commencement)

| Case | `affiliations` | `dartmouth_affiliation` | `department_class` |
|---|---|---|---|
| Current '27 student | Student | DART | `'27` |
| '26 on a +1 term (still enrolled) | **Student only** | DART | `'26` |
| Standard '26, graduated June 2026 | **Alum** + Student | DART | `'26` |
| '25 who did a +1 year, graduated June 2026 | **Alum** + Student | DART | `'25` |

What this pins down:

- **`"Alum"` ∈ affiliations ⟺ degree conferred**, appearing within weeks of Commencement. This is the prompt graduation signal.
- **`"Student"` lingers after graduation** (grace period), so Student alone ≠ enrolled. Currently-enrolled is the compound **Student ∧ ¬Alum** — which correctly identifies +1s whose classYear math says "graduated."
- **`dartmouth_affiliation` stays `DART` for months post-grad**; the `ALUMNI` flip is the long tail, not the fresh signal.
- **`department_class` is class identity, not graduation year** — a '25 on a +1 stays `'25` forever. Fine for display and for the Tier-4 fallback; never treat it as an enrollment signal.

**Known limitation**: a dual-degree BE candidate (AB conferred, BE year still enrolled) is indistinguishable from a fresh graduate (`Alum + Student` both). Tier 0 (below) protects them while they hold a current-term assignment; an unstaffed off-term BE candidate will misread as alumni. If this bites, add a manual `User` override flag — don't try to infer it from the API, the signal isn't there.

## What to build

### 1. Schema additions — `dali-api/prisma/schema.prisma`

Add to `User` (single migration):

```prisma
// api.dartmouth.edu/people cache
dartmouthAffiliation    String?    // raw IDM code: "DART" | "ALUMNI" | ...
dartmouthIsAlum         Boolean?   // "Alum" ∈ affiliations — degree conferred
dartmouthIsStudent      Boolean?   // "Student" ∈ affiliations (lingers post-grad)
dartmouthPeopleSyncedAt DateTime?
```

No other schema changes. Existing `classYear`, `graduatedAt`, `personalEmail` cover the rest.

### 2. API client — `dali-api/app/lib/`

- `dartmouth-people.ts` — `peopleByNetId(netId)`: GET `api.dartmouth.edu/api/people/{netid}` with `Authorization: Bearer {jwt}`. Returns `{ dartmouthAffiliation, isAlum, isStudent, classYear }` or null on 404. `parseDepartmentClass("'27") → 2027`.
- `dartmouth-jwt.ts` — `getDartmouthJwt()`: cached JWT exchanger. POSTs to `/api/jwt` with API key (no optional scope), caches in memory until 5 min before `exp`. All People calls go through this.

Single shared helper `refreshDartmouthSignals(userId, { staleAfterDays })` in `dartmouth-refresh.ts`:
- Skip if `dartmouthPeopleSyncedAt` is fresher than threshold (default **7 days** — must stay under the 14-day trust window in roles.ts)
- Write cache columns; never overwrite an existing `classYear` (user input wins)
- Auto-set `graduatedAt = now()` on the first observed graduation signal (`isAlum` or IDM `ALUMNI`); never overwrite an existing `graduatedAt`
- 404 keeps last-known signals (staleness is already encoded in the synced-at timestamp)

### 3. `isAlumni` derivation — `dali-api/app/lib/roles.ts`

Layered; Tier 0 wins over everything:

```ts
isAlumni(user) =
  has current-term assignment                        → false  // Tier 0: active in the lab is never alumni
  dartmouthIsAlum OR dartmouthAffiliation == "ALUMNI" → true   // Tier 1: degree conferred / IDM flip
  graduatedAt < now()                                → true   // Tier 2: manual/stamped override
  fresh sync AND isStudent AND NOT isAlum            → false  // Tier 3: enrolled (+1 guard)
  classYear past June 15 AND has past assignment(s)  → true   // Tier 4: fallback for never-synced users
  otherwise                                          → false
```

- Tier 0 also protects fresh grads until term rollover (their final-term assignment is still "current"), and staffed BE candidates.
- Tier 3 is the +1 guard, replacing the dead lookup override: SIS-fed enrollment via the affiliations compound. Trust window 14 days, refresh cadence 7 — continuously protected for anyone active weekly.
- Tier 4 needs no API data at all (members with no netId, no API key configured, or nothing synced yet).

Also:
- Add `isAlumni: boolean` to `getUserRoles()` return
- Tweak `isLabMember`: `has DALIMember AND NOT isAlumni` (pure alumni only — current Admin/Core keep authority)
- Add `tier(userId)` resolver returning `Admin | Core | Member | Alumni | Student | Partner`

### 4. Sync triggers — lazy, not cron-driven

- **On any login** — CAS callbacks *and* Google callbacks (members mostly sign in with Google): fire-and-forget `refreshDartmouthSignals`, internally throttled to once per 7 days per user.
- **On shell load** (layout loader, fire-and-forget, in-memory throttled): keeps signals fresh for users with long-lived sessions who rarely re-authenticate.
- **Annual Commencement sweep**: a scheduled task firing June 15 each year that refreshes every `User` with `netId IS NOT NULL` and `classYear == currentYear`. ~30 calls, ~1 minute. Captures the graduating class regardless of whether they've logged in. (Future PR.)

### 5. Alumni sidebar + route guards

Sidebar variant for alumni: **Home**, **People**, **Profile**. Hide Projects, Calendar, Mentorship, Hiring, Core, Admin.

Route guards (deny → redirect to `/`), maintained as `ALUMNI_DENIED_PREFIXES` in `routes/layout.tsx` — **re-check this list whenever a new top-level area ships**:
- `/projects`, `/calendar`, `/mentorship`, `/hiring`, `/core`, `/admin-console`, `/staffing`, `/forms`, `/internal-processes`, `/partners`, `/education`, `/documents`, `/intern-to-full`

Allow:
- `/`, `/profile`, `/members/$id`, `/people`

### 6. Alumni directory — members directory `?status=alumni` tab

- "Alumni" tab next to "Current"
- Class year filter, search by name
- Card click → existing `/members/$id` (read-only for non-self)
- Past project history rendered from existing `ProjectAssignment` rows
- SQL predicate: `dartmouthIsAlum` OR past `graduatedAt` OR classYear past cutoff, **excluding** known-enrolled (`dartmouthIsStudent AND NOT dartmouthIsAlum`) so +1s don't appear a year early

## What we're NOT building yet

- **Magic-link auth on `personalEmail`** — dali emails persist 10+ years, no urgency
- **Coffee-chat opt-in flag, newsletter feed** — wait for real demand
- **Transition notifications / audit log** — `NotificationEvent` model from v0 can carry this when needed; not v1
- **Profile-completion banners** — Notion data is good enough for the 2026 cohort; revisit if data gaps appear
- **Manual `isAlumniOverride` flag** — only if the BE-candidate limitation actually bites

## Edge cases handled

| Case | Outcome |
|---|---|
| Class of 2026 graduates June 2026 | "Alum" appears in affiliations within weeks → Tier 1 (after their final-term assignment rolls off via Tier 0) |
| +1 student (classYear past, still enrolled) | Student ∧ ¬Alum, fresh → Tier 3 → not alumni |
| 5th-year with an active assignment | Tier 0 → not alumni (regardless of any other signal) |
| On-leave member | classYear in future → Tier 4 returns false → not alumni |
| Off-cycle grad | Set `graduatedAt` manually → Tier 2 |
| People API down / key missing | Refresh no-ops with a warning → Tiers 1/3 dark, Tier 2/4 still work |
| Member with no netId | No API sync possible → Tier 4 (classYear math) |
| Member graduates but stays as Dartmouth staff | affiliations = [Alum, Staff] → Tier 1 → alumni of DALI (unless current Admin/Core — authority preserved) |
| BE dual-degree candidate, staffed | Tier 0 → not alumni |
| BE dual-degree candidate, unstaffed off-term | **Misreads as alumni** (identical API signature to a grad) — known limitation, manual override if needed |

## Files touched

- `dali-api/prisma/schema.prisma` (+ migration) — 4 cache columns on User
- `dali-api/app/lib/dartmouth-people.ts` (new) — People client + class-year parser
- `dali-api/app/lib/dartmouth-jwt.ts` (new) — JWT exchange + in-memory cache
- `dali-api/app/lib/dartmouth-refresh.ts` (new) — `refreshDartmouthSignals()` orchestrator
- `dali-api/.env.example` — add `DARTMOUTH_API_KEY`
- `dali-api/app/lib/roles.ts` — `isAlumni`, `tier`, update `getUserRoles`, tweak `isLabMember`
- CAS + Google callback handlers — fire-and-forget refresh on sign-in
- Layout loader — throttled background refresh + alumni route guard
- Sidebar component — alumni layout branch
- Members directory — Alumni tab + class year filter

## Sequencing

1. **PR 1 (#737)** — Schema migration + People client + JWT exchanger + `refreshDartmouthSignals` + login hooks
2. **PR 2 (#739)** — `roles.ts` derivation (Tier 0–4) + `tier` resolver + sidebar variant + route guards + directory tab + tests
3. **PR 3** — Annual Commencement sweep scheduled task

**Prereq**: `DARTMOUTH_API_KEY` set in Fly secrets for staging + prod before PR 1 deploys.

## When to revisit

- If `personalEmail` becomes load-bearing (dali emails actually start expiring) → build magic-link auth
- If alumni ask for active contribution paths (remote mentoring, app review) → design that, not before
- If a BE candidate gets misclassified while off-term → add the manual override flag
- If lookup.dartmouth.edu ever reopens (or IT grants us SSO-exempt access) → it would make a cheaper enrollment signal, but the People compound already covers it
