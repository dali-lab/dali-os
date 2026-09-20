# BetterAuth Migration — Design Doc

**Status:** Phase 0 IN PROGRESS (build log at end). ⚠️ **Design revised 2026-09-18 — the three sign-in surfaces are PRESERVED** (Member / Dartmouth / Partner), reversing the earlier "one surface + background domain-classification" model. §5 below is retained only as rejected rationale; the current model is in §1.
**Branch:** `explore-betterauth-staging` (worktree off `origin/staging`, HEAD ~#1668)
**Author:** Claude (with Kiran)
**Date:** 2026-09-18
**Scope:** Hard cutover of **all identity/login surfaces** in `dali-api/` from the current bespoke auth to [BetterAuth](https://better-auth.com) (v1.7.x), collapsing today's three logins into one.

> **Re-baselined 2026-09-18.** An earlier draft was researched against a stale `origin/dev` base (479 commits behind) and got the current state wrong in material ways. This version is grounded in `staging`, which includes the **membership/alumni subsystem** (`membership-status-sync` job, `MembershipStatus`, `dartmouth-people.ts`) the stale base lacked.

---

## 1. TL;DR

**The design (revised 2026-09-18):** keep BetterAuth as the auth substrate for all identity, but **preserve the three separate sign-in surfaces** — Member, Dartmouth, Partner — exactly as today. The user picks their door; **the door IS the account type — nothing is auto-derived from the email domain.**

> *Why the reversal:* an earlier draft collapsed the three logins into one surface that classified type by verified email domain. That's fundamentally unable to catch the real overlaps — **a DALI student who is also a partner, a grad student who is a partner** (both have happened) — because those people share a domain with a type they *aren't* in that context. Letting them choose the door sidesteps the impossible classification.

Each door moves onto BetterAuth (CAS is dropped):
- **Member** (`@dali.dartmouth.edu`) — **Google + email/password** (password/reset added as a fallback).
- **Dartmouth** (replacing CAS) — a **one-time verification link to a `@dartmouth.edu` address → then set a password**; that verified-email step is the affiliation proof CAS used to give, and **netID is captured** during the flow (directory lookup + self-entry fallback).
- **Partner** — a **one-time verification link → then set a password** (+ optional Google). This "verify email, then create credentials" onboarding is Kiran's chosen pattern for the non-Google doors (maps to BetterAuth's `magicLink` plugin + `setPassword`, both riding the `verification` table — no extra schema).

**The one real piece of new work — netID capture.** Dropping CAS removes today's *only* automatic source of Dartmouth `netId`, which is load-bearing: **payroll** (`JobCodeLookup`) keys on it, and the **membership/alumni auto-sync** (the **live, working** daily `membership-status-sync` job → `api.dartmouth.edu/people/{netid}`) is netID-keyed and skips netID-less users. There's no email/name→netID resolver wired up today — but the **Dartmouth lookup API `lookup.dartmouth.edu/api/search?query=<name>` is reachable from Fly** (returns `uid`=netID + `mail` + affiliation + class), and is the clean replacement: query by name at signup, bind netID on an exact `mail` match. So netID capture is straightforward to rebuild, **not a blocker**. (The `/api/search` path is reachable even though the web *root* is SSO-gated — a stale `dartmouth-people.ts` comment from 2026-07-06 conflates the two; update it.) See §6.

**Everything else is favorable:** the app is already BetterAuth-shaped (DB-backed revocable sessions hashed at rest, one `requireAuth` resolving cookie-or-bearer, roles decoupled from identity, its own OAuth 2.1 provider for MCP, magic links, device pairing). No passwords exist today — this migration introduces the first ones.

---

## 2. Motivation

- **Collapse three logins into one** with background routing (the product goal).
- **Reduce bespoke auth surface** — we own session issuance/rolling/revocation, cookie handling, Google OAuth, CAS XML parsing, an OAuth 2.1 provider, magic links, device pairing.
- **Drop the soon-dead CAS dependency** (Dartmouth is retiring CAS; we've chosen not to integrate its Entra successor).
- **Upgrade impersonation** from the dev-only `dev-login-as` hack to first-class impersonation sessions.

Non-goals: changing the **authorization** model (roles/terms), the **membership/alumni** resolver, non-identity secrets, or the collab layer beyond its session-read call.

---

## 3. Current-state inventory (staging)

### 3.1 Login/identity surfaces (all funnel through one `Session`)

| Surface | Today | Key files |
|---|---|---|
| Member login | Google OAuth (`hd=dali.dartmouth.edu` hint, server-verifies domain); auto-creates `DALIMember` on first login | `routes/login.tsx`, `routes/auth.callback.google.ts`, `lib/oauth.ts`, `lib/user-provisioning.ts` (`lib/google-oauth.ts` = shared token helper, also Gmail/Calendar/MCP) |
| Dartmouth student login | **CAS** ticket → `/serviceValidate` (regex XML); standalone → `/portal`, or chained from Google to capture `netId` | `routes/auth.callback.cas.ts`, `lib/auth.ts` (`validateCasTicket`), `lib/linking.ts` |
| Partner | Magic link (`OneTimeToken`, 15 min, sha256) + Google | `partners/routes/partner.login.tsx`, `partner.auth.verify.tsx`, `partners/lib/magic-link.server.ts`, `partners/lib/partner-auth.server.ts` |
| Desktop (Tauri) | Device-code pairing + 60s handoff; 30d-rolling/**90d-absolute** session | `routes/auth.pair.{start,approve,poll}.ts`, `routes/auth.handoff.ts`, `routes/link.tsx`, `lib/pairing.ts` |
| MCP clients | OAuth 2.1 provider: `/oauth/authorize`+PKCE, dynamic registration (RFC 7591), `/.well-known/oauth-*`, consent, scopes | `routes/mcp.ts`, `routes/oauth.*.ts`, `lib/mcp-auth.ts`, `lib/oauth.ts` |
| Impersonation / dev | `dev-login`, `dev-login-as` (dev/test only, 404 in prod) | `routes/dev-login.ts`, `routes/dev-login-as.ts` |
| Collab (Hocuspocus) | `verifyCollabToken(rawSessionId)` over the WS handshake → `authorizeCollabDoc` | `app/collab/auth.ts`, `app/collab/server.ts`, `lib/collabAuth.ts` |

### 3.2 Session/identity primitives

- **`requireAuth(request)`** (`lib/auth.ts`) — memoized per request; resolves `__dali_sid` cookie **or** `Authorization: Bearer`, looks up `Session` by `sha256(raw)`, checks revoked/expired, rolls expiry, bumps `lastActiveAt`. Returns `AuthUser = { sub, email, type, firstName?, lastName? }`.
- **`type`** derived by `deriveAuthType`: `daliEmail` → `member`; else `netId` → `dartmouth`; else `partner`. (`applicant` is a synthesized display value; partner disambiguation uses a `PartnerContact` row.)
- **`issueSession`/`lookupSession`/`rollSession`/`revokeSession`** (`lib/session.ts`); tokens **sha256-hashed at rest**; cookie `__dali_sid`, HttpOnly, SameSite=Lax, Secure (non-dev), 30d rolling + 30d absolute (90d for desktop); roll throttled to 1/hour.
- **Authz**: `requireCore`, `requireCoreOrDomainLead`, `requireMemberSession`, `requireProjectEditAccess` (`lib/auth.ts`) + `lib/roles.ts` — all live DB queries keyed by `userId`, term-scoped.
- **MCP is a separate gate** (`lib/mcp-auth.ts`): requires `session.grantId`; **re-checks `DALIMember` on every request** (off-boarding kill switch) + per-client `requireMembership`/`requiredAccountType`.

### 3.3 Membership / alumni subsystem (the staging-specific piece)

- **Stored, authoritative status** on `User.membershipStatus` (`MembershipStatus { Active, Alumni }`), plus `membershipStatusOverride` (manual pin, wins) and `membershipStatusComputedAt`.
- **`resolveMembershipStatus(u, now)`** (`lib/membership-status.ts`) — pure resolver; precedence: override → enrolled-grad → `isAlum`/affiliation=ALUMNI → `graduatedAt<now` → `isStudent` → `classYear` past commencement → Active. The invariant is **enrolled = `isStudent && !isAlum`**.
- **Inputs** cached on `User`: `dartmouthAffiliation`, `dartmouthIsAlum`, `dartmouthIsStudent`, `dartmouthDepartmentClass`, `dartmouthPeopleSyncedAt`, `classYear`, `graduatedAt`.
- **Sync**: `refreshDartmouthSignals(userId)` (`lib/dartmouth-refresh.ts`) → `peopleByNetId(netId)` (`lib/dartmouth-people.ts`, `api.dartmouth.edu/people/{netid}`, JWT via `DARTMOUTH_API_KEY` in `lib/dartmouth-jwt.ts`). **Early-returns if `!user.netId`.** Driven by the daily `membership-status-sync` job (3 phases) + a throttled fire-and-forget sync on every CAS/Google login.
- **Member-only**: `recomputeMembershipStatus` no-ops without a `DALIMember` row.

### 3.4 Identity data model

- **`User`** (no password): `netId`, `daliEmail`, `dartmouthEmail`, `personalEmail`, `slackUserId` (all `@unique`, nullable); `firstName`/`lastName`; the §3.3 membership columns; `createdAt`/`updatedAt`.
- **`Session`**, **`OAuthClient`/`OAuthGrant`/`OAuthSession`** (MCP provider), **`OneTimeToken`** (purpose `PartnerMagicLink` live; `AlumniEmailLink`/`EmailVerification` defined-but-unused), **`DevicePairing`** — all hashed at rest.
- **Roles**: `DALIMember`, `CoreAssignment`, `AdminMembership`, `ProjectAssignment`, `InstructorAssignment`, `DomainLeadAssignment`, `DomainEligibility` — term-scoped, keyed by `userId`.
- **Partner**: `PartnerContact` (account-first, `email` unique, nullable `userId`), `PartnerMembership`, `PartnerOrg`, `PartnerUser` (deprecated).

---

## 4. Target BetterAuth architecture

### 4.1 The `auth` instance (`app/lib/betterauth.server.ts`)

```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, apiKey, admin, organization, deviceAuthorization } from "better-auth/plugins";
// Phase 4 (MCP) only: import { jwt } from "better-auth/plugins"; import { mcp } from "@better-auth/mcp";
import { prisma } from "~/lib/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: process.env.API_BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,                  // the system's FIRST passwords
    requireEmailVerification: true, // one-time link on sign-up
    sendResetPassword: async ({ user, url }) => sendEmail({ to: user.email, subject: "Reset your password", text: url }),
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => sendEmail({ to: user.email, subject: "Verify your email", text: url }),
  },
  socialProviders: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! },
    // NO provider-level `hd` — accept all domains; classify/route in the hook below (§5).
  },
  account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
  databaseHooks: {
    user: {
      create: {
        // Classify type by verified email domain; for Dartmouth-affiliated emails
        // attempt netId capture (§6) and enrich membership signals; de-dupe by netId.
        before: async (user) => { /* §5 + §6 */ },
      },
    },
  },
  session: { expiresIn: 60*60*24*30, updateAge: 60*60*24 }, // 30d rolling. NB: do NOT enable cookieCache globally (§10).
  advanced: {
    cookiePrefix: "dali",
    useSecureCookies: true,
    database: { generateId: /* reuse existing cuid strategy */ undefined },
  },
  trustedOrigins: [/* app origins + desktop custom scheme */],
  plugins: [
    bearer(),
    admin(),                 // impersonation (adds an UNUSED `user.role` column — §8)
    deviceAuthorization(),   // desktop (§8 — expiresIn is the CODE ttl, not session lifetime)
    apiKey(),                // service tokens
    organization(),          // partner orgs only (do NOT model lab roles/terms here)
    // Phase 4: jwt() + mcp().  mcp() IS the OAuth provider — no separate oauthProvider().
  ],
});
```

### 4.2 Handler + session read (RR7)

- Handler at `app/routes/api.auth.$.ts` proxying `loader`+`action` to `auth.handler(request)`.
- In loaders/actions: `auth.api.getSession({ headers: request.headers })` — with `bearer()`, resolves cookie **and** bearer in one call (mirrors `requireAuth`). Wrap in a thin `requireUser`/`requireCore` shim so call-sites barely change.
- Required models: `user`, `session`, `account`, `verification` (+ plugin tables). Generate via `@better-auth/cli generate`, then `prisma migrate` (never hand-edit an applied migration).

---

## 5. Login model — one surface, background routing  ⚠️ SUPERSEDED (2026-09-18)

> **This entire section is superseded — see the revised design in §1.** The one-surface / background-domain-classification model was reversed: the three sign-in surfaces (Member / Dartmouth / Partner) are **preserved**, and the user picks their door. **Do not implement §5.1's domain-classification routing** — it can't disambiguate a student-who-is-also-a-partner. What survives from this section: netID capture (§6), now scoped to the **Dartmouth door's signup flow** rather than a universal `create` hook. The subsections below are retained only as explored-and-rejected rationale.

**Everyone: email + password, with optional "Sign in with Google."** No type picker; magic link retired (partners move to password). This is BetterAuth's default shape.

### 5.1 Type is derived, never chosen

Routing is **relationship-first, email domain only as a tiebreaker** — mirroring today's layout loaders, which already check `DALIMember`, then `PartnerContact`, before the portal fallback. Computed post-`getSession`, in order:

1. **`DALIMember`** (or a `@dali.dartmouth.edu` identity) → **member**, `/`.
2. **Explicit `PartnerContact` / active `PartnerMembership`** → **partner**, `/partner`. This **wins over the email domain**: a Dartmouth **professor who is a partner** has an `@dartmouth.edu` address but belongs in the partner portal. The account-first `PartnerContact` row (created by Core when logging the inquiry/invite) is the authoritative partner signal — *not* the domain.
3. **Non-member with an active `InstructorAssignment`** → **`/portal`** (education/instructor lens) — external/guest instructors, professor or grad student (today's "external instructors → `/portal`" behavior). Placed ahead of step 4 so a professor-instructor isn't defaulted to `/partner`. See the role-holder note below.
4. Else, for `@dartmouth.edu`, classify with the lookup (the same call that captures netID, §6.2):
   - **Any Dartmouth student → Dartmouth** (`/portal`) — undergrad *and* grad/professional across **all schools** (Thayer, Guarini, Geisel, Tuck). Detect via a **student signal**: `eduPersonPrimaryAffiliation === "Student"` **or** a `dcDeptclass` that is a class year (`'27`) or a grad-program code (`TH`/`GR`/`DM`/`TU…`) — the same primitives the membership resolver uses (`parseDepartmentClass` / `isGraduateProgramClass`). Keying on the *signal* (not just primary affiliation) means an **employed grad student** (TA/RA, whose primary may read `Staff`) still lands in Dartmouth, not Partner. If the search fields are ambiguous, the netID we just captured lets us call the JWT People API (`peopleByNetId`) for the authoritative `affiliations[]` / `isStudent`.
   - **Non-student staff/faculty → partner** (`/partner`) — e.g. an external professor (dept-name `dcDeptclass` like `"ArtSci DALI Lab"`, no student signal). DALI staff (e.g. Tim) are caught earlier by rule 1.
   - Anything not under `dartmouth.edu` → **partner**.

So for a brand-new person with **no relationship row yet**:

| Verified domain (no relationship row) | Lookup signal | Type | Home |
|---|---|---|---|
| `@dali.dartmouth.edu` | — | DALI | `/` |
| `@dartmouth.edu` | **student** (any school — `Student`, class year, or grad-program code) | Dartmouth | `/portal` |
| `@dartmouth.edu` | staff/faculty, no student signal | Partner | `/partner` |
| anything else | — | Partner | `/partner` |

Rules 1–3 still precede this (member/DALI-staff → `/`, logged partner → `/partner`, non-member instructor → `/portal`). **Residual edge:** a lookup that can't classify (name miss / ambiguous) — default the `@dartmouth.edu` signup to `/portal` and let Core reclassify, or prompt for netID (§6.2 fallback).

**Non-member role-holders (e.g. external instructors).** `type`/home is only the *default landing* — it does **not** gate capabilities. Teaching authority is an `InstructorAssignment` (→ `isInstructor`, `canViewForms`), keyed on `userId` and checked independently of `DALIMember`/`type`, so a **professor or grad-student instructor who is not a DALI member** keeps full instructor access to their offering however they classify. For *landing*, this is **step 3** in the routing list above (non-member + `InstructorAssignment` → `/portal`), placed ahead of the domain fallback so a professor-instructor (`Staff`) isn't defaulted to `/partner`. (The rare partner-who-also-instructs keeps their `/partner` home and still opens the offering they teach via the role grant — capabilities aren't shell-bound.) This is the general principle: **BetterAuth owns identity/session; every role capability stays in the existing `userId`-keyed tables, unchanged** — so any other non-member role (guest reviewer, etc.) behaves the same way.

> **UI note (adjacent, out of auth scope).** Routing a non-member instructor to `/portal` matches today's behavior, but `/portal` is currently *applicant-flavored* — wrong for a **Dartmouth professor who only teaches** (not an applicant, not a partner). The fix is presentation, not auth: `/portal` should render **by capability** — an `isInstructor` user with no applicant intent sees an instructor/education-focused home (their offerings/roster/materials) with applicant-onboarding cards suppressed. The portal already supports conditional home cards (education redesign), so this is a scoped product refinement of the destination shell. **Flagged, not part of the auth cutover** (the cutover preserves current routing).

**Overlapping roles are a Venn diagram, not a single `type`.** Dartmouth-student (S), DALI-instructor (I), and faculty (P) overlap freely — a grad student who teaches (S∩I), a professor who teaches (P∩I), an employed grad-student-instructor (S∩I∩P). A single scalar `type` can't represent this, so model **independent capabilities** (`isMember`, `isInstructor`, `isDartmouthStudent`, `isFaculty`, `isPartner` — all `userId`-keyed, term-scoped):
> - **Landing** is a coarse default (member → `/`; any Dartmouth role/relationship incl. instructor *or* student → `/portal`; partner → `/partner`). `type` survives only as this default hint, **never** an access gate.
> - **Access/UI is the union of capabilities**, each surface gated by its own check.
>
> Resolved (Kiran):
> - **Instructor UI is identical for every instructor** — DALI member, grad student, or professor. No faculty-specific view, differences, or abilities within education.
> - **Portal home renders by capability** — a non-student (professor) doesn't see applicant/enroll cards; a student does. This capability-gated split (via the directory student-signal) is the *only* UI difference across regions, not a special role view.
> - **Education roles are per-offering:** a person may **teach Y while enrolled in X**, but **cannot be both instructor and student of the same offering/term** — enforce app-side.
> - **Pay:** instructor pay is `InstructorAssignment` → JobX code 8271, keyed on netID; it surfaces in the admin **Payroll Export** regardless of student status — no blending issue (just requires the netID we already capture).
> - **Alumni (deferred):** DALI *and* Dartmouth alumni are both intended to use the **member shell layout** (not built out yet). DALI alumni already land there (persistent `DALIMember` + `membershipStatus = Alumni`). Alumni-instructor allowed, not a priority now.
>
> All of this is **app/UI + education-domain work**, not auth — the capabilities live in `roles.ts`/`DALIMember`/`InstructorAssignment`; the migration only *adds* the student/faculty directory signal that lets the portal disambiguate. Flagged as adjacent, not part of the auth cutover.

**Subdomain handling** (within the domain fallback, rule 4 — after the relationship + instructor checks). `@dali.dartmouth.edu` → DALI (checked first); bare `@dartmouth.edu` → Dartmouth-or-Partner by lookup affiliation (rule 4 above); anything not under `dartmouth.edu` → Partner. Use **exact-host suffix matching** (`@` + exact domain), never a substring, so lookalikes (`dartmouth.edu.evil.com`, `notdartmouth.edu`) can't slip in. Open case: any *other* `*.dartmouth.edu` address (a school/department/service subdomain) — **only relevant if such addresses exist for real users (TBC with Kiran).** If they do, don't trust the string: attempt the netID lookup (§6.2), resolves → Dartmouth else Partner (excluding non-human service domains). If in practice everyone is `@dali` or bare `@dartmouth.edu`, this case never fires and the rule is just the clean three-way split. (CAS used to be the affiliation oracle; the lookup restores that rigor without a hard-coded allowlist.)

### 5.2 Affiliation gate — solved for free

CAS implicitly proved "is a Dartmouth person." Here, **domain + verified ownership is the proof**: you can't hold a `@dartmouth.edu`/`@dali.dartmouth.edu` account without controlling that mailbox (the verification link, or Google's verified email). Partners = verified email, non-Dartmouth domain. (Note: affiliation ≠ netID — see §6.)

### 5.3 Google open to everyone (no provider-level `hd`)

One Google provider must accept `@dali`, `@dartmouth`, and partner domains; `hd` only expresses one domain, so we classify by domain in the hook. Google is optional; **password is the universal path** (many Dartmouth students are Microsoft-only). Password flow ships whole (sign-up, reset, verification, scrypt) over the existing `sendEmail`.

### 5.4 Identity linking

BetterAuth is **one canonical `email` per `user`** with credential login keyed on it. One human can span domains, so:
- **One primary login email** per person + **linked identities** (Google, second domain) on the same `User`.
- **Same-email linking is native** (`accountLinking` by verified email).
- **Cross-domain merge is custom, keyed on `netId`** — the surviving core of today's `lib/linking.ts` (which merges a Google `@dali` identity with a CAS `@dartmouth`/netId identity). This does **not** disappear; it moves into the signup/provisioning hook. See §6.

---

## 6. netID & membership — the hard part

This is the section that determines whether the migration is viable as scoped.

### 6.1 How it works today (and why CAS matters beyond login)

- `netId` is written by **exactly four paths**, all CAS-sourced or manual: standalone CAS (`upsertUserFromCas`), CAS→Google link (`linkCasToGoogleUser`), the Google callback's redirect to CAS when `!user.netId` (`auth.callback.google.ts:262-270`), and a Core operator **typing** a netId into the instructor-invite form (`offerings.server.ts`).
- **No email→netID or name→netID resolver is *wired up* in the code.** `peopleByNetId` is keyed *by* netID. The searchable directory `lookup.dartmouth.edu/api/search` (name→uid) exists and is **reachable from Fly** (confirmed by Kiran) — a `dartmouth-people.ts:4-6` comment (2026-07-06) calls lookup "unreachable," but that tested the **web root** (`GET /` → SAML); the **`/api/search` JSON path is open**. It just isn't called yet.
- `netId` gates: **payroll** (`JobCodeLookup`) and the **membership/alumni sync** (`refreshDartmouthSignals` early-returns without it; the daily job's candidate query requires `netId != null`).

**So removing CAS removes the only *currently-wired* automatic netID capture** — until we call the lookup API (§6.2). A user with no netID yet (before the lookup resolves, or a lookup miss) gets `netId = null` and uses the manual `classYear`/`graduatedAt`/override fallback for membership status until it's filled.

### 6.2 Options to re-bootstrap netID (pick one; this is the gating decision)

1. **`lookup.dartmouth.edu/api/search?query=<name>` (name→uid) — the primary path.** Reachable from Fly (the `/api/search` path is open even though the web root is SSO-gated). Returns `uid` (=netID), `mail`, affiliation, `dcDeptclass`. Query by the user's name at signup and **bind netID only when a returned `mail` exactly matches the verified email** (never on a fuzzy name-only match — a wrong netID = wrong payroll identity). Auto-fill `classYear` from `dcDeptclass` opportunistically. The same response's **`eduPersonPrimaryAffiliation`** (Student / Staff / Faculty) drives §5.1 rule-4 routing (student → Dartmouth, staff/faculty → partner). The lookup is called server-side via `fetch` (like the existing People-API client — no `curl`/shell dependency on the Fly image).
2. **Self-entered netID, validated via `peopleByNetId()`** — the fallback when the lookup misses (name typo, ambiguous match). User enters their netID; accept only if the JWT People-API record's name/affiliation matches.
3. **Capture at hiring/provisioning.** DALI already knows a hire's netID; attach it when provisioning the `@dali` account. Robust for members.
4. ~~Email-domain/local-part heuristic~~ — rejected (unreliable; `@dartmouth.edu` local part ≠ netID).

**Recommendation:** (1) primary (lookup by name, bind on exact `mail` match), (2) as the miss fallback, (3) for hires. Accept that **membership/alumni auto-sync only runs once a netID exists** — the rare netID-less member uses the manual fallback until then.

### 6.3 Login identities → `account` rows

| Provider | `providerId` | `accountId` | Notes |
|---|---|---|---|
| Email + password (everyone) | `credential` | user's own `id` | password hash on the `account` row, not `User` |
| Google (optional, any domain) | `google` | Google `sub` | **not stored today** — `lib/oauth.ts` discards `payload.sub`; backfill lazily via `accountLinking` (verified email) or capture on first login |

Multiple `account` rows per user are fine. Same-email linking is native; cross-domain is the netID-keyed custom merge (§5.4/§6.2).

---

## 7. Data-model mapping

### 7.1 `User` → BetterAuth `user` (map to existing table)

- `modelName`/`fields` point BetterAuth at the existing `User` table.
- **Add** a canonical `email` column (precedence `daliEmail` → `dartmouthEmail` → `personalEmail`) + `emailVerified: boolean` (backfill `true` for existing users). BetterAuth owns these; existing identity columns stay.
- Existing identity + **all membership columns** (`netId`, the `dartmouth*` signals, `membershipStatus*`, `classYear`, `graduatedAt`, etc.) → `additionalFields` with `input: false`. The membership resolver/sync keep reading/writing them unchanged.
- Reuse existing cuids via `advanced.database.generateId`.

### 7.2 Legacy auth tables

| Legacy | Fate |
|---|---|
| `Session` | → BetterAuth `session`; drop post-cutover (sessions reset). |
| `OneTimeToken` | Magic link retired → no successor; drop after partner cutover. |
| `DevicePairing` | → device-auth plugin tables; drop after desktop cutover. |
| `OAuthClient`/`OAuthGrant`/`OAuthSession` | **Kept** — our OAuth provider stays (Option A). Only the bespoke `Session` it issued moves to a BetterAuth session (with a `grantId` custom field). |
| Role/membership + membership-status columns + Partner tables | **Unchanged** — domain data keyed by `userId`. |

---

## 8. Authorization & peripheral surfaces

**Authorization is unchanged.** `lib/roles.ts`, the membership resolver, and `collabAuth.ts` all key on `userId` (from `session.user.id`). `AuthUser.type` recomputed from identity columns + `DALIMember` (drop the dead `type === "applicant"` branch).

| Surface | Decision | Notes |
|---|---|---|
| Desktop pairing | Migrate → `deviceAuthorization` | ⚠️ plugin `expiresIn` = code TTL, **not** session lifetime; today's 30d-rolling/90d-absolute desktop split needs custom lifetime handling. Flag in the desktop PR (`/auth/pair/*`, `/auth/handoff`, `/link`). |
| Impersonation | Migrate → `admin` `impersonateUser` | Default 1h; **audit logging not built in** (wire existing `logAuditEvent`); adds an unused `user.role` column (authorization stays in role tables). |
| MCP | **Keep our OAuth provider; ride BetterAuth sessions** (decided — Option A) | Keep the `/oauth/*` + `/.well-known/*` routes, `OAuthClient`/`OAuthGrant`, scopes, and the membership kill-switch. Swap only the substrate: `/oauth/token` mints a **BetterAuth session** (add a `grantId` via session `additionalFields`) instead of a bespoke `Session` row; `authenticateMcpRequest` = `getSession(bearer)` → `grantId` → grant/scope + per-request `DALIMember`/`requiredAccountType` checks (unchanged). Endpoints stay put → **no client re-discovery**; one-time re-auth at cutover. Migrating onto BetterAuth's `mcp()` plugin is a **separate later decision** (OQ#4) — deferred because that plugin is mid-overhaul (DCR→CIMD) and chasing a fast-moving spec. |
| Collab | Update session read | Swap `verifyCollabToken` (`app/collab/auth.ts`) to validate via BetterAuth; Hocuspocus passes the token over the **WS handshake, not headers** — build a synthetic `Headers` for `getSession`. `collabAuth.ts` authz unchanged. |
| Jobs `x-jobs-secret`, Slack/GitHub HMAC, form-fill tokens, wallet HMAC | **Leave** | Not identity. |

---

## 9. Migration & backfill

1. **Schema**: `@better-auth/cli generate` + `User.email`/`emailVerified` → `prisma migrate`.
2. **Backfill**: populate `User.email` (precedence), `emailVerified = true`, and `account` rows for Google identities.
3. **Existing users set a password** (or keep using Google): CAS-provisioned Dartmouth users have no credential → email a "set your password" link or let them use forgot-password; existing members can continue via Google.
4. **netID**: existing users keep their CAS-captured netID; new users go through the §6.2 path chosen.
5. **Forced global re-login**: `__dali_sid` sessions don't translate to BetterAuth sessions. Everyone re-authenticates once. Plan a comms window; low blast radius (roles/data untouched).

Zero-downtime dual-run for sessions is impossible (opaque formats differ) — hence the hard cutover.

---

## 10. Security

- **Session token at rest — accepted:** today all tokens are sha256-hashed at rest; BetterAuth stores `session.token` un-hashed (the stored value *is* the cookie). **Decision: accept BetterAuth's documented model** — it's the maintained default, tokens are high-entropy and expiring, and DB access is already the trust boundary; not worth diverging from the library. (Password hashes (scrypt) and verification/reset tokens are still hashed by BetterAuth.)
- **Passwords (new surface):** scrypt default; `requireEmailVerification` + `sendOnSignUp`; `requestPasswordReset` must return a neutral response (anti-enumeration); reset/verification tokens in the `verification` table — confirm single-use + short TTL.
- **Rate limiting — parity + new:** port today's limits (login 5/min, oauth/token 200/min, magic-link 5/10min, pairing-poll IP+slow_down) onto BetterAuth's rate-limit config, **plus** sign-up / sign-in / password-reset / verification-resend.
- **`cookieCache`:** delays revocation by its TTL and is incompatible with the MCP per-request membership re-check — do not enable globally.
- **`trustedOrigins`:** include app origins + the desktop custom scheme or CSRF rejects requests.
- **`account_not_linked`:** correct `account` backfill (esp. Google `sub`) or first post-migration logins error.
- **Version pinning:** BetterAuth ships breaking changes in minor releases (1.7 renamed MCP APIs) — pin exact versions.
- **Secrets:** new `BETTER_AUTH_SECRET`; reuse `GOOGLE_CLIENT_ID/SECRET`; **keep `DARTMOUTH_API_KEY`** (membership sync is independent of the login mechanism). Never log/echo.

---

## 11. Phased rollout

- **Phase 0 — Prep:** add dep (pinned), `betterauth.server.ts`, adapter, generate+migrate schema, `User.email`/`emailVerified` + backfill (dry-run), handler route, compat shim, and **the netID-bootstrap mechanism (§6.2) built + tested**. Nothing wired to real logins.
- **Phase 1 — Human login (cutover):** Google (all domains, classified) + email/password + verification, behind a flag. Existing CAS users get a set-password link. Flip → forced re-login.
- **Phase 2 — Desktop:** device-authorization plugin.
- **Phase 3 — Impersonation:** admin plugin; retire `dev-login-as`.
- **Phase 4 — MCP (re-point to BetterAuth sessions):** keep the provider routes; change `/oauth/token` to mint a BetterAuth session (custom `grantId` field) and `authenticateMcpRequest` to `getSession(bearer)` + grant/scope/membership checks. Endpoints unchanged (no client re-discovery); clients re-authorize once. **Spike first:** server-side session minting for a given user at the token endpoint (the device-auth/admin plugins already do this). Migrating to the `mcp()` plugin is out of scope here — see OQ#4.
- **Cleanup:** delete `lib/session.ts`, `lib/cookies.ts`, CAS parsing (`validateCasTicket` + callbacks), `lib/pairing.ts`, and the session bits of `lib/auth.ts`; relocate `lib/linking.ts`'s netID-merge. **Adapt (don't delete) `lib/mcp-auth.ts`** — it now reads BetterAuth sessions. Drop the bespoke **`Session`** table; **keep `OAuthClient`/`OAuthGrant`/`OAuthSession`** (the provider stays). **Do NOT delete `lib/google-oauth.ts`** (shared token helper for Gmail/Calendar/integrations). **Keep `dartmouth-people.ts`/`dartmouth-refresh.ts`/`membership-status.ts` and the sync job** — unaffected by the auth swap.

---

## 12. External dependencies

- **Google Cloud Console**: register redirect `…/api/auth/callback/google`.
- **Transactional auth email**: reset + verification via existing `sendEmail` (dev-skips/staging-redirects apply).
- **Dartmouth People API** (`api.dartmouth.edu/people/{netid}`, `DARTMOUTH_API_KEY`): **unchanged, still needed** for membership sync.
- **Dartmouth lookup API** (`lookup.dartmouth.edu/api/search`): reachable from Fly — powers netID capture (§6.2). Update the stale 2026-07-06 `dartmouth-people.ts` comment that calls it unreachable (it tested the SSO-gated web root, not `/api/search`).
- *No Dartmouth ITC/IdP login dependency* — Dartmouth SSO dropped.

---

## 13. Open questions

1. **netID bootstrap (§6.2):** confirm the approach — lookup `/api/search` by name (primary, reachable) + self-entry fallback + capture-at-hiring. No longer a blocker.
2. **Accept degraded membership sync** for the rare netID-less member (manual `classYear`/`graduatedAt`/override) until a netID is captured — yes/no?
3. **Affiliation gate**: restrict non-member sign-up to `@dartmouth.edu`/`@dali` or allow any email + check in-app? (Domain+verification already gates; this is about sign-up UX.)
4. **MCP** — *decided:* keep our provider on BetterAuth sessions (Option A, §8). Re-evaluate migrating to BetterAuth's `mcp()` plugin later, triggered by the plugin settling post-CIMD *or* needing a spec feature our provider lacks (CIMD / `iss` validation / DPoP). Note the MCP spec's DCR→CIMD shift (2026-07-28) reaches us either way — the deferred sub-question is whether *we* implement CIMD/`iss` in our provider or adopt the plugin when that need arrives.
5. ~~Session-token-at-rest~~ — *decided:* accept BetterAuth's un-hashed session-token storage (§10).
6. **`*.dartmouth.edu` subdomains** — factual Q for Kiran: does anyone sign in with a subdomain *other* than `@dali` / bare `@dartmouth.edu`? If **no**, the domain fallback is the clean three-way split (exact-host matching); if **yes**, classify those by netID-lookup resolution (§5.1). (Domain is only a *fallback* — relationship rows decide member/partner first, and within the fallback the lookup's `eduPersonPrimaryAffiliation` splits `@dartmouth.edu` into student→Dartmouth vs staff/faculty→partner, so a professor routes correctly either way. §5.1.)
7. **Primary-email stability** on applicant→member: keep first email as login id, or promote to `@dali` on hire?
8. **Google `sub` backfill**: lazy-link on first login (verified email) vs pre-create — confirm.

---

## 14. Rollback

Each phase is flag-gated. Phase 1 resets sessions on flip **and** rollback. Keep legacy auth code in-tree until each phase is proven; delete at Cleanup. MCP (Phase 4) retains the existing provider as a full fallback.

---

## 15. Phase 0 build log (2026-09-18)

Pinned **`better-auth@1.7.5`** (exact). Verified compatible with this stack: Prisma 7 (in peer range; adapter guide is written *for* Prisma 7), Zod 4, RR7 7.14.0, Node 22 ESM. Note for later phases: `apiKey` is now the separate `@better-auth/api-key` package and MCP is `@better-auth/mcp` (`mcp()` + `requireMcpAuth`).

**Files created / changed:**
- `app/lib/betterauth.server.ts` — the `auth` instance. Plugins = **`bearer` only** (admin/deviceAuthorization/apiKey/organization/jwt+mcp deferred to their phases so their tables don't land early). Email/password with `requireEmailVerification`; Google with **no `hd`**; `accountLinking` (google trusted); 30-day rolling session; `advanced.database.generateId: false` (DB `@default(cuid())` owns ids); `user`/`session` mapping (see gotcha below); a `create.before` hook that **only splits `name` → firstName/lastName** (NOT classification).
- `app/lib/dartmouth-lookup.ts` + `__tests__/dartmouth-lookup.test.ts` (**28 tests, green**) — netID directory client: `bindNetIdByEmail` binds a netID only on an **exact verified-mail match**; `validateSelfEnteredNetId` is the People-API fallback. ⚠️ The `/api/search` **wire format is ASSUMED**, isolated in `parseDirectoryResponse` — confirm against a real response.
- `prisma/schema.prisma` — added `User.email` (nullable + unique for now), `emailVerified`, `name`; new `AuthSession`, `Account`, `Verification` models (ids `@default(cuid())`).
- `prisma/migrations/20260918120000_betterauth_core/migration.sql` — additive, safe on populated data. **NOT applied** (applying is an operator step needing `DIRECT_URL`, per `prisma/MIGRATIONS.md`).
- `prisma/scripts/backfill-betterauth-email.ts` — dry-run-by-default backfill (email precedence `daliEmail→dartmouthEmail→personalEmail`, collision-safe, sets `emailVerified=true`/`name`).
- `app/routes/api.auth.$.ts` + `app/lib/betterauth-compat.server.ts` — RR7 handler (`auth.handler`) + a thin `requireUser`/`requireCore` shim over `auth.api.getSession`, mirroring today's `AuthUser`/`deriveAuthType` contract. **Not wired into existing routes** (Phase 0 = scaffolding).

**Corrections to the plan discovered while building:**
1. **Email** — transactional auth mail goes through `enqueueOutbound()` + `drainNow()` (purpose `General`), NOT the raw `sendEmail({text})` in §4.1's sketch (real `sendEmail` needs a Gmail refresh token).
2. **Session table** — BetterAuth's session is a **separate `AuthSession` table** (`session.modelName` override), so the bespoke `Session` (sha256 id, `grantId`→`OAuthGrant`) keeps working through cutover; dropped only at cleanup.
3. **`modelName` gotcha** — it's the **camelCase Prisma client accessor** (`user`, `authSession`), not the PascalCase model name; PascalCase makes BetterAuth report the tables "missing."
4. **netID student-signal** — uses `graduateProgramLabel()` (closed set of the four grad schools), NOT `isGraduateProgramClass()` (a has-letters heuristic that misflags a staffer's department name as a grad program). See §5.1's now-superseded wording.

**Phase 0 COMPLETE + verified** (2026-09-18): typecheck = 11 pre-existing baseline errors / 0 new; **4717 unit tests pass**; BetterAuth's own schema validator reports no mismatch; the `auth` module imports clean. Nothing applied to a DB; nothing wired to real logins. **Phase 1 COMPLETE + verified** (2026-09-18) — all human login on BetterAuth behind the `betterauth` flag (off; flipping it is the cutover + forces a global re-login):
- **`magicLink` plugin** (rides `verification`, no schema) — powers the verify-link→set-password onboarding.
- **Session coexistence** — `betterauth` feature flag (global switch) + `requireAuth` falls back to a BetterAuth session when the legacy lookup finds none (lazy-imported, fault-isolated; flag off = byte-identical legacy). 4 coexistence tests.
- **Dartmouth door** (`/login/dartmouth` + `/login/dartmouth/set-password`, replaces CAS): @dartmouth.edu-gated `signInMagicLink` → verify → `setPassword` + `captureDartmouthIdentity` (netID via lookup best-effort; `dartmouthEmail` is the type signal). 8 capture tests.
- **Member door** (`login.tsx`, flag-branched): `signInSocial` (Google) + email/password (`signInEmail`, Set-Cookie forwarded via `returnHeaders`) + Forgot-password (`requestPasswordReset` → `/login/reset-password` landing → `resetPassword`). A `create.after` hook provisions DALIMember + daliEmail + handle for @dali signups (domain-conditional).
- **Partner door** (`partner.login.tsx` + `/partner/set-password`): `signInSocial` + `signInMagicLink` (member-conflict guard preserved) → `setPassword` (no netID/no member row).
- **Verification:** typecheck 11 pre-existing baseline / 0 new; full unit suite green (~4729 tests). **Runtime caveat:** the magic-link/Google click-throughs and server-side sign-in need a manual `npm run dev` + DB pass before cutover — not exercisable in the worktree.

**Phases 2 / 3 / 4 BUILT + verified** (2026-09-18, branch `betterauth-phase-2-4`, stacked on the Phase 0+1 PR — a second PR). All flag-gated behind `betterauth`, all needing integration testing before the flag is enabled:
- **Phase 3 — impersonation** (`admin` plugin): migration `20260918130000` adds `user.role/banned/banReason/banExpires` + `AuthSession.impersonatedBy`. `POST /admin/impersonate` gates on our real `AdminMembership` (`isAdmin`) and JIT-sets the actor's `user.role="admin"` so the plugin gate passes (no standing sync); `POST /admin/stop-impersonating`; both audit-logged; Set-Cookie forwarded. `dev-login-as` left intact. 11 tests.
- **Phase 4 — MCP (Option A)**: keep our OAuth provider; migration `20260918140000` adds `AuthSession.grantId`. `app/lib/betterauth-session.server.ts` `mintBetterAuthSession()` isolates the one internal-adapter `createSession` call. `/oauth/token` mints a BetterAuth session (grantId) → its token is the `access_token`; `authenticateMcpRequest` tries the legacy path first, then a BetterAuth session (fault-isolated) — in-flight tokens survive the cutover. 18 tests.
- **Phase 2 — desktop**: **no plugin, no schema change** — keeps DALI's custom pairing flow + native `/auth/pair/*` contract; only the two `issueSession` points swap. Poller → 90-day BetterAuth Bearer session (reuses `mintBetterAuthSession`); handoff → webview session + a signed BetterAuth cookie via `app/lib/betterauth-cookie.server.ts` (reuses better-call's `serializeSignedCookie`). ⚠️ The webview cookie round-trip needs an integration test before enabling. 12 tests. *(Justified deviation from §8: adopting the deviceAuthorization plugin would break the native contract.)*

**Still deferred (post-cutover):** cleanup — drop the legacy `Session`/CAS/`OneTimeToken`, tighten `User.email` to NOT NULL after the backfill. This removes the *live* legacy path, so it only happens once BetterAuth is proven enabled in prod.

## Appendix: Sources

- BetterAuth: [Email & Password](https://better-auth.com/docs/authentication/email-password) · [Google](https://better-auth.com/docs/authentication/google) · [React Router v7](https://better-auth.com/docs/integrations/react-router) · [Prisma adapter](https://better-auth.com/docs/adapters/prisma) · [Sessions](https://better-auth.com/docs/concepts/session-management) · [Cookies](https://better-auth.com/docs/concepts/cookies) · [Users & Accounts](https://better-auth.com/docs/concepts/users-accounts)
- Plugins: [Bearer](https://better-auth.com/docs/plugins/bearer) · [JWT](https://better-auth.com/docs/plugins/jwt) · [API Key](https://better-auth.com/docs/plugins/api-key) · [Admin](https://better-auth.com/docs/plugins/admin) · [Organization](https://better-auth.com/docs/plugins/organization) · [Device Authorization](https://better-auth.com/docs/plugins/device-authorization) · [MCP](https://better-auth.com/docs/plugins/mcp)
- Repo (staging): `lib/dartmouth-people.ts`, `lib/dartmouth-jwt.ts`, `lib/dartmouth-refresh.ts`, `lib/membership-status.ts`, `jobs/membership-status-sync.server.ts`, `lib/linking.ts`, `lib/user-provisioning.ts`, `specs/alumni_status_plan.md`.
