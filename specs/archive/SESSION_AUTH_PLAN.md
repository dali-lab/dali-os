# Session Auth Refactor — Implementation Plan

**Status:** Pre-implementation. Supersedes the auth model implied by issue #407 and updates the auth section of `dali-os-mcp.md`. Lands as a single coordinated change before the MCP track begins, because the MCP foundation depends on this.

## Goal in one sentence

Replace the current JWT access token + rotating refresh token scheme with **opaque session ids stored in a `Session` table**, used uniformly for browser logins (cookie) and OAuth-issued MCP grants (`Authorization: Bearer` header).

## Why this document exists

Issue #407 proposed switching browser auth from JWT/RT to opaque sessions. That proposal is sound on its own, but it predates the OAuth-for-MCP direction in `dali-os-mcp.md`. Implementing #407 as-written would create a second auth surface for MCP six months later. This doc unifies both — one auth concept, one table, one validation path — and lays out the work to get there.

## Current state (what we're replacing)

| File | Role | LOC |
|---|---|---|
| `app/lib/auth.ts` | JWT sign/verify, `requireAuth` with silent refresh, `withAuth` glue | 217 |
| `app/lib/oauth.ts` | Token issuing, RT rotation with family detection, OAuth provider session (PKCE) | 337 |
| `app/lib/cookies.ts` | `__dali_at` + `__dali_rt` cookie helpers | 65 |
| `RefreshToken` model | tokenHash, family, expiresAt, familyCreatedAt — rotation state | (schema) |
| `OAuthSession` model | PKCE/authorize-step state for the OAuth provider | (schema, kept) |

**Behavior:**
- Login issues a 15-minute HS256 JWT (in `__dali_at` cookie) and a 7-day opaque refresh token (in `__dali_rt` cookie, hashed at rest).
- Refresh tokens rotate on use within a `family`; reuse is detected and revokes the family.
- `requireAuth` verifies the JWT; on expiry, it transparently swaps the RT for a new AT/RT pair and the route's loader/action returns the response through `withAuth(auth, response)` so the new `Set-Cookie` headers get attached.
- Absolute session cap of 30 days from `familyCreatedAt` (added in `2c01467` to prevent infinite chains).
- 111 files in `app/` import `withAuth`.

**Pain points that motivated #407:**
- Silent refresh requires `withAuth` on every loader/action return. Forgetting it silently breaks the UX. Caused incident `1757c2a` (users bounced every 15 min).
- `inFlightRefreshes` dedup map in `auth.ts` exists only to keep parallel loaders from tripping RT reuse detection.
- Two cookies, two expiries, two clear paths, family revocation, `JWT_SECRET` rotation, etc.
- Revoking a refresh token leaves the access token live for up to 15 minutes.
- The justifications for the JWT/RT split (stateless hot path, side-channel asymmetry, scale) don't apply to this codebase. See `Alternatives considered` below.

## Target state (what we're moving to)

One `Session` row backs every authenticated request — browser or MCP. Validation is one indexed PK lookup.

### Schema (new)

```prisma
model Session {
  // SHA-256 hash (base64url) of the raw session id. The raw id is what
  // travels in cookies and Bearer headers; we never store it directly.
  // PK lookup stays indexed and O(1). Mirrors the RefreshToken.tokenHash
  // precedent — defense in depth against a DB read leaking live sessions.
  id                 String   @id
  userId             String
  // Null for cookie logins. Set for OAuth-issued (MCP) sessions, linking
  // the session to the OAuthGrant that authorized it.
  //
  // Intentionally a plain String? in this PR — no FK target until the
  // OAuthGrant model lands in the MCP foundation track. That migration
  // adds the foreign-key constraint and the OAuthGrant? relation. Until
  // then, grantId is unused at runtime (issueSession always omits it for
  // cookie logins).
  grantId            String?
  createdAt          DateTime @default(now())
  // Updated on every successful auth lookup. Drives the rolling expiry
  // and powers per-session telemetry (last seen, idle revocation).
  lastUsedAt         DateTime @default(now())
  // Rolling expiry: extended on use up to absoluteExpiresAt.
  expiresAt          DateTime
  // Hard cap: never extended. Equivalent to today's familyCreatedAt + 30d.
  absoluteExpiresAt  DateTime
  // Soft delete. Sessions are never hard-deleted so audit log stays whole.
  revokedAt          DateTime?
  // Optional, populated at issuance for audit / "active sessions" UI.
  userAgent          String?
  ip                 String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([grantId])
  @@index([expiresAt])
}
```

Reverse relation on `User`:
```prisma
sessions Session[]
```

**Hashed-at-rest convention:**
- Issuance: generate `raw = base64url(crypto.randomBytes(32))`. Insert a row with `id = sha256(raw)`. Return `raw` to the caller.
- Lookup: receive `raw` from cookie or Bearer header. Compute `sha256(raw)`. `findUnique({ where: { id: sha256(raw) } })`.
- The raw id never hits the database. A read-only DB leak surfaces hashes, not live credentials.
- Same hashing convention as today's `RefreshToken.tokenHash`. No new cryptographic primitives.

### Schema (dropped)

- `RefreshToken` model — and its `User.refreshTokens` reverse relation.

### Schema (unchanged)

- `OAuthSession` — still backs the authorize→callback→exchange round-trip for the OAuth provider surface. This is the *PKCE state*, distinct from the new `Session` model (which is the *resulting credential*).

### Cookie

One cookie: `__dali_sid`. HttpOnly, `SameSite=Lax`, `Secure` in production, `Path=/`. Value is the session id verbatim.

### Bearer header

`Authorization: Bearer <session_id>`. The same id that goes in the cookie. No JWT, no separate format.

### `requireAuth` (new shape)

```ts
async function requireAuth(request: Request): Promise<AuthResult> {
  const raw = parseSessionId(request); // cookie first, header fallback
  if (!raw) return { ok: false, reason: "no_session" };

  const session = await prisma.session.findUnique({
    where: { id: sha256(raw) },
    include: { user: true },
    // grant lookup comes back when the OAuthGrant model lands; for this
    // PR session.grantId is unused at runtime
  });

  if (!session) return { ok: false, reason: "not_found" };
  if (session.revokedAt) return { ok: false, reason: "revoked" };
  const now = new Date();
  if (session.expiresAt < now || session.absoluteExpiresAt < now) {
    return { ok: false, reason: "expired" };
  }

  // Roll the expiry. Fire-and-forget — a failed update doesn't block the request.
  rollSession(session.id).catch(() => {});

  return { ok: true, user: { sub: session.userId, ...session.user }, sessionId: session.id };
}
```

No silent refresh. No `withAuth` wrapper — loaders and actions just return data.

**Return shape compatibility:** the `auth.user.sub` field is preserved so the codemod is purely a `withAuth` strip. Today's callers (`auth.user.sub` is used in `app/calendar/`, `app/collab/server.ts`, etc.) keep working unchanged. The plan does not rename or restructure the user object as part of this PR — that would conflate concerns. If a future cleanup wants to surface `userId` directly instead of `sub`, it's a separate PR.

### Issuance

```ts
async function issueSession(params: {
  userId: string;
  grantId?: string;
  ttlMs?: number;          // default ROLLING_TTL_MS
  absoluteTtlMs?: number;  // default ABSOLUTE_TTL_MS
  userAgent?: string;
  ip?: string;
}): Promise<string> // returns raw session id
```

Called by:
- `/auth/callback/google` and `/auth/callback/cas` (cookie login) — `grantId` omitted.
- `/oauth/token` (MCP) — `grantId` set to the `OAuthGrant.id`.
- `/dev-login-as` — same as cookie login.

### Token endpoint behavior

`/oauth/token` with `grant_type=authorization_code` returns:
```json
{
  "access_token": "<session_id>",
  "token_type": "Bearer",
  "expires_in": <seconds until rolling expiry>,
  "user": { ... }
}
```

`grant_type=refresh_token` becomes a no-op or is removed entirely. Sessions auto-extend on use; MCP clients keep using their bearer until they get a 401, then re-run the authorization flow. RFC 6749 permits omitting `refresh_token` — many native MCP clients don't use it anyway.

### Revocation

- **Logout**: `UPDATE session SET revokedAt = NOW() WHERE id = $1`. Instant. Cookie cleared on the response.
- **Sign out everywhere**: `UPDATE session SET revokedAt = NOW() WHERE userId = $1 AND revokedAt IS NULL`. One statement.
- **Revoke an MCP grant**: `UPDATE oauth_grant SET revokedAt = NOW() WHERE id = $1; UPDATE session SET revokedAt = NOW() WHERE grantId = $1`. Atomic via transaction.
- **Compromised user**: same as sign-out-everywhere. No 15-minute stale window.

## Alternatives considered

### A. Status quo (keep JWT + rotating RT)

**Pros:** zero migration risk; well-trodden OAuth pattern.

**Cons:** the issue #407 list — silent-refresh footgun, two recent bugs, `withAuth` glue on every route, 15-min revocation lag, `JWT_SECRET` rotation story. Also conflicts with MCP plans for instant grant revocation.

**Rejected because:** the complexity is producing bugs and the design justifications don't apply here. Same-origin app, both credentials on cookies, DB hit per request anyway for role checks.

### B. Sessions for browser only (issue #407 as-written)

**Pros:** all of A's wins, no MCP-related design work yet.

**Cons:** MCP will need a separate Bearer-token validation path within ~6 months. Builds the same simplification twice. The "API access goes away" con in #407 directly contradicts the OAuth-MCP plan.

**Rejected because:** suboptimal sequencing. Doing it once for both is strictly less work than doing it twice.

### C. Hybrid — sessions for browser, JWTs for Bearer

**Pros:** keeps the OAuth standard's familiar AT/RT shape for MCP clients.

**Cons:** two validation paths, two issuance paths, two revocation stories, two cookies-vs-headers reconciliations. All the costs of both designs.

**Rejected because:** JWTs aren't required by OAuth. RFC 6750 (Bearer tokens) doesn't mandate any token format. The resource server is the same app as the issuer, so stateless validation is wasted. Spec-compliant opaque bearers are simpler and equivalent.

### D. Unified sessions (chosen)

**Pros:**
- One concept, one table, one validation path, one cookie (or header), no JWT machinery, no silent refresh, no `withAuth` glue, no `JWT_SECRET`.
- Instant revocation everywhere.
- MCP-ready by construction.
- Less code (estimated ~500 lines deleted on net).
- Same operational hygiene wins for MCP (per-grant last-used, per-grant revoke) that #407 gives the browser.

**Cons:**
- One indexed DB lookup per authenticated request. Negligible at our scale, already amortized against the role-check lookups that happen anyway.
- Loses the rotating-RT "reuse detection" alarm. Mitigated by short rolling expiry + `lastUsedAt` audit. We can add anomaly checks (impossible-travel, UA flip) later if motivated.
- Migration touches 111 files (mechanical: removing `withAuth` wrappers).

**Why this is the right call:** the JWT/RT design is overkill for a same-origin internal web app at our scale, and it's actively obstructing the MCP track. The simplification reduces lines of code, eliminates a known class of bugs, and unblocks the next feature in the same move.

## Implementation phases

This is implemented as one PR. The work cleanly splits internally but doesn't split well across multiple PRs — leaving the system half-converted creates a dual-auth state that's worse than either endpoint. Phases below describe the order of work *within* the PR, not separate deliverables.

### Phase 1 — Schema + `Session` library

1. Prisma migration:
   - Create `Session` table per the schema above.
   - Add `User.sessions` relation.
   - **Drop `RefreshToken` table and `User.refreshTokens` relation.**
   - Migration is data-losing for `RefreshToken`. This is acceptable because the cutover forces re-login anyway.
2. New `app/lib/session.ts`:
   - `generateSessionId()` — 32 bytes from `crypto.randomBytes`, base64url.
   - `issueSession(params)` → returns raw id, writes row.
   - `lookupSession(id)` → returns row with user + grant, or null.
   - `rollSession(id)` → bumps `lastUsedAt` and `expiresAt` (capped at `absoluteExpiresAt`).
   - `revokeSession(id)`, `revokeAllForUser(userId)`, `revokeAllForGrant(grantId)`.
   - Constants: `ROLLING_TTL_MS = 30d`, `ABSOLUTE_TTL_MS = 30d` (matches current behavior; both knobs adjustable).

### Phase 2 — Rewrite `auth.ts` and `cookies.ts`

3. `app/lib/cookies.ts`:
   - Remove `setTokenCookies`, `clearTokenCookies`, `parseRefreshToken`.
   - Add `setSessionCookie(headers, sessionId)` (HttpOnly, SameSite=Lax, Secure in prod, Path=/, Max-Age = `ROLLING_TTL_MS`).
   - Add `clearSessionCookie(headers)`.
   - Add `parseSessionCookie(request)`.
4. `app/lib/auth.ts`:
   - Delete `signAccessToken`, `verifyAccessToken`, `JWT_SECRET` usage, `inFlightRefreshes`, the silent-refresh path inside `requireAuth`, and the `withAuth` helper.
   - Keep `requireAuth` signature; rewrite body per the "new shape" above.
   - Keep `validateCasTicket` (unrelated).
   - Add `parseBearerHeader(request): string | null` and have `parseSessionId` try cookie first, header second.
   - Drop the `jose` import; remove `jose` from `package.json` if no other consumer remains (`grep` to verify).
5. `app/lib/oauth.ts`:
   - Delete `signAccessToken` import.
   - Delete `issueTokens`, `refreshTokens`, the `createTokenPair` internal helper, the `RefreshToken` Prisma calls, `revokeToken` in its current form.
   - Keep the OAuth provider surface: `createOAuthSession`, `getOAuthSession`, `generateAuthorizationCode`, `exchangeAuthorizationCode`, `verifyPKCE`, `VALID_CLIENT_IDS` (this becomes the registry lookup later; for this PR keep the constant). `OAuthError` stays.
   - Replace what `exchangeAuthorizationCode`'s callers do — they used to call `issueTokens`; now they call `issueSession` (Phase 4).

### Phase 3 — Strip `withAuth` from callers

6. Mechanical change across 111 files: every `withAuth(auth, value)` becomes `value`. Replace `withAuth(auth, redirect("/login"))` with `redirect("/login")`, etc.
   - Do this with `find` + `sed` or an AST codemod, then a hand review of diffs that don't look mechanical.
   - Drop the `withAuth` import line in each file.
7. `requireAuth` return type tightens — no more `headers` field. Anything reading `auth.headers` (there shouldn't be much outside `withAuth`) gets cleaned up.

### Phase 4 — Wire issuance into login flows

8. `routes/auth.callback.google.ts`:
   - Replace `issueTokens(user.id, authType)` + `setTokenCookies(headers, at, rt)` with:
     ```ts
     const sid = await issueSession({
       userId: user.id,
       userAgent: request.headers.get("user-agent") ?? undefined,
       ip: getClientIp(request),
     });
     setSessionCookie(headers, sid);
     ```
9. `routes/auth.callback.cas.ts`: same change.
10. `routes/dev-login.ts`, `routes/dev-login-as.ts`: same change. Guard remains non-prod-only.
11. `routes/logout.ts`: read the session id from the cookie, call `revokeSession(id)`, then `clearSessionCookie(headers)`.

### Phase 5 — Wire issuance into OAuth provider

12. `routes/oauth.token.ts`:
    - For `grant_type=authorization_code`: call `exchangeAuthorizationCode`, then `issueSession({ userId, ... })`. Return `{ access_token: sid, token_type: "Bearer", expires_in, user }`. (`grantId` plumbed through in the MCP foundation track; for this PR it's omitted.)
    - For `grant_type=refresh_token`: **remove this branch**. Document the removal in the PR description. (Today no one calls it externally; the cookie-login path that used it is now session-based.)
13. `routes/oauth.revoke.ts`:
    - Accept a session id (either via cookie or body `token`), call `revokeSession`, clear the cookie. Functionally equivalent today; ready for MCP grant-revoke once grants land.

### Phase 5.5 — Collab server (Hocuspocus)

The collab server has its own auth path and is **not** caught by the `withAuth` codemod. Missing this would silently break Tiptap document editing on the deploy.

Current shape:
- `app/collab/auth.ts` re-exports `verifyAccessToken` as `verifyCollabToken`.
- `app/collab/server.ts:78` calls `verifyCollabToken(token)` inside Hocuspocus `onAuthenticate`. The token comes from the client via the WS handshake.
- Loaders in `hiring/routes/reviewer.application.$id.tsx`, `hiring/routes/interviewer.interview.$interviewId.tsx` (and any others that render a `CollaborativeEditor`) currently call `parseAccessToken(request)` to pull the JWT out of the cookie and pass it through loader data as `collabToken`.

Changes:

14. `app/collab/auth.ts`:
    - Replace the `verifyAccessToken` re-export with a session-backed `verifyCollabToken(raw: string)` that does the same lookup `requireAuth` does (hash → `findUnique` → check `revokedAt` / `expiresAt`) and returns `{ sub: userId }` so `collab/server.ts` consumers (`user.sub`) keep working unchanged.
    - Optionally `rollSession` here too — every collab handshake counts as activity.
15. **All loaders that pass `collabToken` through loader data** (grep for `parseAccessToken` and for `collabToken` in the JSX):
    - Replace `parseAccessToken(request)` with `parseSessionCookie(request)`. The variable name `collabToken` can stay or rename to `collabSessionId` — non-load-bearing.
    - The `token` prop on `CollaborativeEditor` / `PresenceProvider` is now the raw session id instead of a JWT. Same string shape from the client's perspective.
16. **Threat-model note** — the WS handshake already carries the same credential as the HTTP cookie (today: the JWT; after refactor: the session id). Blast radius unchanged. If we want to tighten this later, the right move is to issue short-lived, document-scoped collab tokens; that's a separate concern and explicitly out of scope here.

### Phase 6 — Tests

17. Delete and rewrite:
    - `app/lib/__tests__/auth.test.ts` — sign/verify/refresh tests gone; cookie+header parsing, expiry, revoked, rolling expiry, sign-out-everywhere, hash-at-rest (raw in cookie, hashed in DB).
    - `app/lib/__tests__/oauth.test.ts` — keep PKCE / authorize-session tests; delete token-pair tests; add `issueSession` tests there or in a new `session.test.ts`.
    - `app/lib/__tests__/cookies.test.ts` — rewrite for single cookie.
    - `app/lib/__tests__/dev-login.test.ts` — light update; cookie name changes.
15. E2E (`e2e/`):
    - `fixtures.ts` / `reviewer.spec.ts` use `/dev-login-as` — should still work; verify session cookie is set, no second cookie.
    - Add an E2E that exercises Bearer-header auth against a known-protected route. Doesn't need MCP infra — just curl with `Authorization: Bearer $(get-session-id)`.

### Phase 7 — Cleanup

19. Search for stale references:
    - `grep -r "__dali_at\|__dali_rt\|JWT_SECRET\|refreshTokens\|signAccessToken\|verifyAccessToken\|verifyCollabToken\|parseAccessToken\|withAuth\|RefreshToken" app/ e2e/` — should return only intentional matches (e.g., audit-log strings if any).
    - Drop `JWT_SECRET` from `docker-compose.yml`, `fly.*.toml`.
    - Drop `jose` from `package.json` if unused.
20. Update docs:
    - `dali-os-mcp.md` — change the schema section to use `Session` (with `grantId` set) instead of `RefreshToken`. Update flow description: `/oauth/token` returns a session id, not a JWT.
    - `README.md` — auth surface section briefly notes session-cookie + Bearer-header model.

## Cutover plan

**Hard cutover.** Forced re-login for everyone, single deploy.

**Why not dual-read:**
- Dual-read means temporarily running *both* validation paths simultaneously — the riskiest moment in the migration is also the moment with the most surface area.
- The drop of `RefreshToken` is irreversible without restoring from backup. A dual-read intermediate doesn't actually buy reversibility.
- User-facing effect of hard cutover is *one click* to log in again. Low cost for an internal tool with hundreds of members.

**Sequence:**
1. Open PR. Run tests + Playwright in CI.
2. Land on `dev`. Burn in on the dev Neon branch for ~24 hours. Confirm: no auth-related errors in logs, dev-login-as still works, manual smoke covers all three login providers + logout.
3. Promote to `staging`. Staging has a prod snapshot — verify the migration drops `RefreshToken` cleanly against real data shapes.
4. Post a heads-up in `#dali-eng` (or wherever) ~24 hours ahead: *"Auth refactor lands tomorrow at 4pm; you'll be logged out once and need to sign in again. Bear with us."*
5. Promote to `prod` outside of a hiring-cycle deadline window. Cycle activity (open/release) should not be the same hour.
6. Monitor: login success rate, auth-error rate, `lastUsedAt` updates flowing on `Session`. 30-minute attentive window post-deploy.

**Rollback:**
- If detected pre-`prod`: revert PR, redeploy. `RefreshToken` table still exists on prod.
- If detected post-`prod`: hard. The migration drops `RefreshToken`; rolling back requires restoring from Neon's point-in-time recovery, which kicks everyone off again. For all but a catastrophic auth break, the right move is *fix forward*. Have a hotfix branch ready (e.g., revert the session lookup to a permissive mode) before deploying to prod.

## Testing strategy

### Unit (Vitest)

Cover, at minimum:
- `issueSession` writes a row with the right TTLs. Stored `id` is the hash; returned id is the raw.
- `lookupSession` returns `null` for missing / revoked / past-`expiresAt` / past-`absoluteExpiresAt`. Verify a raw id with no matching hash returns `null` (not an error).
- `rollSession` advances `expiresAt` but never past `absoluteExpiresAt`.
- `revokeSession`, `revokeAllForUser`, `revokeAllForGrant` flip the right rows. (`revokeAllForGrant` ships now; takes effect once `OAuthGrant` lands.)
- `requireAuth` accepts cookie, accepts Bearer, prefers cookie when both present.
- `requireAuth` returns the expected `reason` for each failure mode (used by upstream error handling).
- `requireAuth` returns `auth.user.sub` matching the session's `userId` (regression guard for the codemod).
- Logout clears the cookie and revokes the session.
- `verifyCollabToken` resolves the same raw session id as `requireAuth` and returns `{ sub }` in the legacy shape.

### Integration (Vitest against Postgres service container, per `test.yml`)

- Full login flow: hit `/login` → mock provider callback → assert one row in `Session`, one `Set-Cookie`, no other cookies.
- OAuth token flow: simulate `/oauth/authorize` + `/oauth/token` end-to-end, assert the returned `access_token` corresponds to a `Session` row.

### E2E (Playwright)

- Existing `dev-login-as` flow continues to pass.
- New: smoke for the Bearer header (curl-style with a known session id).
- New: log out from one tab, verify the other tab is immediately unauthenticated on next request.

### Manual smoke (before promoting to prod)

- All three login paths (Google member, Google partner via `@dartmouth.edu`, CAS).
- Logout.
- Wait 30+ minutes idle, refresh — should still be logged in (rolling extends), no "bounced every 15 min" regression.
- Revoke a session row directly in Prisma Studio → next request 302s to `/login`.
- **Collab smoke**: open a Tiptap-backed document (reviewer application or interviewer interview), confirm presence indicator appears, type and confirm content persists after refresh. Open the same doc from a second browser session and confirm cursors sync. This catches the `collab/auth.ts` path.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Auth bug ships, users locked out | Low | High | Burn-in on dev for 24h; staging mirrors prod data; deploy outside cycle deadlines; rollback plan documented |
| Session ID guessable | Very low | High | 32 bytes (256 bits) from `crypto.randomBytes`, base64url. Industry standard. |
| DB lookup latency adds up | Low | Low | Indexed PK lookup; same Postgres already serves role checks per-request. Add a SLI on `requireAuth` latency post-deploy if concerned. |
| Cookie leaks across context | Very low | High | HttpOnly + SameSite=Lax + Secure in prod (same as today). |
| `RefreshToken` drop is irreversible | Certain | Medium | Accepted — re-login is one click. Schedule outside high-activity hours. |
| 111-file mechanical edit misses a spot | Medium | Low-Medium | Codemod + grep verify; CI catches type errors from leftover `withAuth` imports. |
| `withAuth` removal breaks a non-obvious side effect | Low | Medium | `withAuth` only did two things: pass-through, or attach Set-Cookie. Pass-through is null-op. Set-Cookie is gone because silent refresh is gone. There's no other side effect to lose. |
| OAuth provider tests still reference `issueTokens` | Medium | Low | Caught by Vitest; rewrite test setup helpers. |
| Anomaly detection lost (rotating-RT reuse alarm) | n/a | Low | Threat model is an internal tool; `lastUsedAt` + IP/UA on the row is enough. Add anomaly checks if motivated. |
| Collab path missed (Hocuspocus `onAuthenticate` keeps verifying JWT) | Medium | High | Tiptap docs would stop authenticating mid-deploy. Phase 5.5 covers `collab/auth.ts` + loader `parseAccessToken` → `parseSessionCookie` swap. Manual smoke confirms a doc loads end-to-end on staging. |
| `auth.user.sub` shape silently changes | Low | Medium | Preserved by design (see locked-in decisions). Vitest assertion `result.user.sub === session.userId` in `auth.test.ts` is a regression guard. |

## Out of scope (intentionally deferred)

- **"Active sessions" UI** for members to see and revoke their own sessions. Easy to add later — the data is on the row. Punted because v1 of MCP doesn't need it and browser users get instant revocation via logout already.
- **Anomaly detection** (impossible-travel, UA flip). Add when motivated by a real incident.
- **Document-scoped collab tokens.** The collab WS handshake carries the same credential as the HTTP cookie (today's JWT, post-refactor: the session id). Same blast radius as today; not made worse. A future refactor could issue short-lived, document-scoped tokens specifically for collab — that's its own track.
- **API keys / non-MCP programmatic access.** Separate concern; sessions issued via OAuth grants cover the MCP need.
- **Scope vocabulary for MCP.** Lives in `dali-os-mcp.md`; orthogonal to this work.

## Open decisions to make before merging

1. **Drop `refresh_token` grant from `/oauth/token` entirely, or stub it?** RFC 6749 permits omitting it. Stubbing means returning the same session id as both `access_token` and `refresh_token`, which is a lie but is compatible with naive clients. **Recommendation: drop entirely.** MCP clients we care about (Claude Desktop, Claude Code) don't require it.
2. **Cookie name.** `__dali_sid` proposed. Worth bikeshedding once, then never again.
3. **TTLs.** Current: AT 15m, RT 7d sliding, 30d absolute. Proposed: rolling 30d, absolute 30d (matches today's RT behavior, drops the AT concept). Could shorten rolling for paranoia. **Recommendation: 30d rolling, 30d absolute.** Same effective security as today.
4. **Capture `userAgent` / `ip` from day one?** Cheap; useful for the future "active sessions" UI and incident forensics. **Recommendation: yes.**
5. **Where does `getClientIp(request)` come from?** Fly forwards via `Fly-Client-IP`; fall back to `X-Forwarded-For`. Trivial helper.

**Locked-in design decisions** (resolved during review, no longer open):

- **Hash session ids at rest.** `Session.id` stores `sha256(raw_id)`; raw id travels in cookies/Bearer headers; lookups are `findUnique({ where: { id: sha256(input) } })`. PK lookup stays indexed and O(1). Mirrors the `RefreshToken.tokenHash` precedent.
- **`grantId String?` without FK in this PR.** Column ships now; the FK constraint and `OAuthGrant?` relation land in the MCP foundation track's migration.
- **`auth.user.sub` preserved.** The `requireAuth` return shape keeps the `user.sub` field so the 111-file edit is purely about removing `withAuth`. Renaming to `userId` (if ever wanted) is a separate concern, separate PR.

## How this enables the MCP track

After this lands, the MCP foundation work described in `dali-os-mcp.md` becomes shorter:

| MCP foundation step (from `dali-os-mcp.md`) | Status after this refactor |
|---|---|
| Client registry (`OAuthClient` model) | Still needed |
| Per-client redirect URIs + loopback matching | Still needed |
| Existing-session shortcut on `/oauth/authorize` | Still needed; trivially "is there a valid `__dali_sid` cookie?" |
| **Bearer-token acceptance in `requireAuth`** | **Done by this refactor.** |
| Scope plumbing (session → access token claim → middleware enforcement) | Now: scope plumbing → `Session.scopes` column → middleware. Cleaner than JWT claims. |
| `OAuthGrant` model + consent screen | Still needed; `Session.grantId` already wired. |
| `.well-known/oauth-authorization-server` | Still needed |
| Settings > Connected apps UI | Still needed; reads from `OAuthGrant` joined to `Session` for last-used. |

`Session.scopes` (a `String[]` column added during the MCP track) replaces the JWT scope claim and is enforced in the MCP middleware. The MCP server's auth layer reduces to: `requireAuth(request) → check session.scopes → dispatch`.

## Estimated effort

| Phase | Effort |
|---|---|
| 1 — Schema + session lib | 0.5 day |
| 2 — Rewrite auth/cookies/oauth lib | 1 day |
| 3 — Strip `withAuth` across 111 files | 0.5 day (codemod + review) |
| 4 — Login-flow wiring | 0.5 day |
| 5 — OAuth provider wiring | 0.5 day |
| 5.5 — Collab server (Hocuspocus) + loader `parseAccessToken` swap | 0.5 day |
| 6 — Tests | 1 day |
| 7 — Cleanup + docs | 0.5 day |
| Burn-in / staging verify / prod deploy | 1 day across calendar time |
| **Total** | **~5.5 focused days + 1 calendar day for safe deploy** |

This is meaningfully less than the cost of building the MCP foundation on top of the existing JWT/RT scheme and *then* doing #407 later.

## Cross-references

- Issue #407 — the original sessions proposal. This doc supersedes it.
- `dali-os-mcp.md` — the MCP plan. After this refactor lands, update its schema section to use `Session` instead of `RefreshToken`.
- `app/lib/auth.ts:24-176` — current JWT + silent-refresh implementation (replaced).
- `app/lib/oauth.ts:228-330` — current `issueTokens` / `refreshTokens` / `revokeToken` (replaced).
- `app/lib/cookies.ts` — current cookie helpers (replaced).
