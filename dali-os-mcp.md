# DALI OS MCP Plan

**Status:** Quality-of-life integration. Lands after v0 of the broader expansion plan (see `expansion_plan.md`). No schema additions are needed in v0 — the OAuth foundation already exists and the small extensions described here ship with the MCP track itself.

## Context

DALI OS exposes an **MCP (Model Context Protocol) server** so AI assistants — Claude Desktop, Claude Code, and any other MCP-compatible client — can interact with DALI OS data on a lab member's behalf.

The use case: a member working in Claude wants to ask *"who's on Project Alpha right now?"* or *"schedule a 30-minute weekly with my Project Alpha team starting next week"* without leaving their AI assistant. MCP makes DALI OS one of the AI's tools.

**Consumer scope:** lab members only (current members + Core). Not partners, not alumni, not the public. This is the single most important constraint — it collapses most of the OAuth-provider machinery you would otherwise need.

**Why this is post-v0:** members can do everything via the DALI OS UI. MCP is leverage on top of a working platform — ship after the platform exists.

## Auth model

**OAuth 2.1 + PKCE.** No Personal Access Tokens. The existing `lib/oauth.ts` already implements the hard parts (mandatory S256 PKCE, single-use authorization codes, opaque refresh tokens hashed at rest, refresh-token family rotation) — it just needs to be extended from one hardcoded client to a small registry, and to surface a few standard endpoints.

**Why OAuth over PAT:**
- A token bound to a registered client, a consent record, and a refresh-token family is materially safer than a bearer secret a member pastes around. Revocation, last-used tracking, and rotation come for free.
- Standard flow — every MCP client speaks it. PATs would require per-client config docs and copy-paste.
- The existing implementation is ~80% of the way there. The remaining work is small *because* the consumer is lab-internal — no dynamic client registration, no scope-by-scope consent UI, no confidential clients, no introspection.

**Why this is small (lab-internal collapses the surface):**

| Standard OAuth concern | Required here? |
|---|---|
| Dynamic client registration (RFC 7591) | No — handful of known clients, seeded once |
| Full consent UI with scope grants | No — one-time per-client confirmation as a phishing guard |
| Confidential vs public clients | No — all MCP clients are native/public; PKCE is the only client auth |
| Token introspection (RFC 7662) | No — same app issues and consumes the tokens |
| Authorization server metadata (RFC 8414) | Yes — MCP clients discover endpoints via `.well-known` |
| Loopback redirect URIs (RFC 8252) | Yes — Claude Desktop/Code use `http://127.0.0.1:<port>/callback` |

### Flow

1. Member configures their MCP client with `https://dalios.dartmouth.edu/mcp` as the server URL.
2. MCP client fetches `/.well-known/oauth-authorization-server`, discovers the authorize/token endpoints.
3. MCP client opens the member's browser to `/oauth/authorize?client_id=claude-desktop&redirect_uri=http://127.0.0.1:<port>/callback&response_type=code&code_challenge=...&code_challenge_method=S256&state=...&scope=mcp:read mcp:write`.
4. **Existing-session shortcut:** if the member has a valid dali-os session cookie, skip the Google/CAS bounce. Otherwise log them in normally.
5. **First-time consent** for this `(user, client)` pair: a single page asking "Authorize Claude Desktop to access your DALI OS account?" with the requested scopes shown. Stores an `OAuthGrant` row on approval. Subsequent authorizations with the same scopes are auto-approved.
6. Redirect to the loopback URI with `?code=<opaque>&state=...`.
7. MCP client exchanges the code at `/oauth/token` with its `code_verifier`. Receives an opaque session id as the bearer (30 days rolling, 30 days absolute cap). See `SESSION_AUTH_PLAN.md` for the unified `Session` model that backs both browser cookies and MCP bearers.
8. MCP client uses `Authorization: Bearer <session_id>` on `/mcp` calls. Sessions auto-extend on use; no `refresh_token` grant — when the rolling TTL lapses, the client re-runs the authorization flow (one redirect if the member still has a dali-os cookie).
9. Member can revoke the grant from Settings at any time — cascades `revokedAt` to every `Session` row tied to that grant.

### Extensions needed to `lib/oauth.ts` and `/oauth/*`

These are all small. Sequencing is in the implementation phases section.

| Extension | Current state | What changes |
|---|---|---|
| **Client registry** | `VALID_CLIENT_IDS = ["dali-api"]` constant array | New `OAuthClient` Prisma model; seeded with `dali-api`, `claude-desktop`, `claude-code`. `lib/oauth.ts` resolves clients via `getClient(clientId)`. |
| **Per-client redirect URIs** | `getAllowedRedirectUris()` returns one frontend URL | Resolved from the client record. Loopback rule: for clients flagged `isLoopback`, match scheme + host (`http://127.0.0.1` or `http://localhost`), ignore port. Exact match for everything else. |
| **Existing-session shortcut on `/oauth/authorize`** | Always bounces through Google/CAS | If the request carries a valid `__dali_sid` cookie, skip straight to consent → code. Only force provider auth when there's no session. |
| **First-time consent screen** | None — code is generated immediately after provider auth | New route `/oauth/consent`. For first-party (`dali-api`) and previously-granted (user, client, scopes) pairs, skip the screen. For new grants, render it; on approve, insert `OAuthGrant` and continue. |
| **Scopes** | `scope` param ignored | Plumb through `OAuthSession` → `OAuthGrant` → access token claim. Enforced in MCP route middleware. |
| **Bearer-token acceptance** | ~~`requireAuth` reads JWT from cookie only~~ Done by the session refactor. `requireAuth` already accepts `Authorization: Bearer <session_id>`; cookie wins if both present. | n/a |
| **Discovery endpoint** | None | `GET /.well-known/oauth-authorization-server` returns the RFC 8414 JSON document (issuer, authorize/token/revoke URIs, supported grants, supported PKCE methods, supported scopes). Static-ish; can be a single loader. |

Out of scope: dynamic client registration, introspection, confidential clients, OIDC `id_token`, userinfo endpoint. Add later if a concrete need shows up.

## Member onboarding flow

What it actually looks like to connect an MCP client to DALI OS. This section pins the operational requirements that the auth design has to satisfy — specifically loopback redirect URIs, the existing-session shortcut, and the per-client consent record.

### Step 1: Add the server

The only thing a member configures is the server URL.

**Claude Code** (one CLI command, per machine):

```bash
claude mcp add --transport http dali-os https://dalios.dartmouth.edu/mcp
```

**Claude Desktop** (edit `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart the app):

```json
{
  "mcpServers": {
    "dali-os": {
      "url": "https://dalios.dartmouth.edu/mcp"
    }
  }
}
```

**Other MCP-over-HTTP clients** (Cursor, Zed, custom): same URL. Any compliant client discovers endpoints via `/.well-known/oauth-authorization-server` and handles OAuth + PKCE automatically. Adding a new client type to DALI OS = adding one seeded row to `OAuthClient`.

### Step 2: First tool invocation triggers auth

The member triggers any tool ("list my projects"). Because the client has no token yet, it runs the OAuth flow:

1. Client fetches `/.well-known/oauth-authorization-server`, discovers `/oauth/authorize` and `/oauth/token`.
2. Client generates a PKCE `code_verifier` + `code_challenge` (S256).
3. Client spins up a loopback listener on a random local port — e.g., `http://127.0.0.1:54113/callback`. (This is why `OAuthClient.isLoopback` exists: the port is dynamic per session, so the server must match scheme + host and ignore port.)
4. Client opens the member's default browser to:

   ```
   https://dalios.dartmouth.edu/oauth/authorize
     ?client_id=claude-code
     &response_type=code
     &redirect_uri=http://127.0.0.1:54113/callback
     &code_challenge=<challenge>
     &code_challenge_method=S256
     &state=<random>
     &scope=mcp:read+mcp:write
   ```

In the browser, three sub-cases:

| Member's state | What they see |
|---|---|
| Already signed in to DALI OS (cookie session valid) | Skip Google/CAS entirely (existing-session shortcut). Go straight to consent. |
| Not signed in | Standard `/login` page, pick Google or CAS, then consent. |
| First time authorizing *this client* | One-time consent screen: *"Authorize Claude Code to access your DALI OS account?"* with the requested scopes listed. Approve once; future re-authorizations for the same `(member, client, scopes)` skip this screen. |

On approval, browser redirects back to `http://127.0.0.1:54113/callback?code=<opaque>&state=<echoed>`. The client's loopback listener catches it, closes itself, and exchanges the code at `/oauth/token` with its `code_verifier`. Receives a session id as the bearer token.

The member's original tool call now completes. Total clicks: typically 1 (consent), occasionally 2 (consent + sign-in if cookie expired).

### Step 3: Steady state

The MCP client stores the session id in its own credentials store (keychain on macOS for Claude Code / Claude Desktop). Every MCP call carries `Authorization: Bearer <session_id>`. The member never sees the token. Sessions auto-extend on use up to the absolute cap (~30 days).

### Idle expiry and re-auth

If the session goes 30 days without use, the next call returns 401. The client re-runs the OAuth flow:
- Cookie still valid in their browser → one redirect, no clicks. They notice a browser tab opening and closing.
- Cookie also expired → one Google or CAS click.

Either way, no token to copy-paste. No "rotate your credentials" hygiene to remember.

### Revocation

| Revoke from | What it does | When to use |
|---|---|---|
| **DALI OS Settings → Connected apps** | Sets `OAuthGrant.revokedAt`; cascades to every `Session` row under that grant. Within one request cycle, the MCP client starts getting 401s and prompts re-authentication. | Compromised laptop, member offboarding, "I don't use this anymore." Authoritative. |
| **MCP client side** (`claude mcp remove dali-os` or removing the config entry) | Deletes the client-side credential. Server-side grant + session linger as inactive. | Cleaning up your own machine. **Not** sufficient for a security incident — the session id still works if someone has it. |
| **DALI OS Settings → "Sign out everywhere"** | One statement revokes every cookie session *and* every OAuth grant for the member. | Suspected account compromise. Nuclear option. |

Members are told in the docs to revoke from DALI OS Settings (not just the client side) when they actually want the credential dead.

### What the member never has to do

- Generate, name, or paste a token.
- Configure a client_id or client_secret (the client knows its own ID; no secret exists because all MCP clients are public/native).
- Pick individual scopes (the client requests them; the consent screen shows them; member approves the bundle).
- Rotate anything (sessions auto-extend; expired sessions trigger a one-click re-auth).

This is the operational payoff for choosing OAuth over PAT: from the member's seat, connecting Claude to DALI OS is *one config line and one consent click*. No long-lived secret in member hands, no copy-paste accidents, no rotation hygiene.

### What needs to exist on the DALI OS side for this to work

- `OAuthClient` rows seeded for each supported client (`claude-code`, `claude-desktop`, anything else added later).
- Loopback redirect URI matching (`isLoopback: true` clients accept any port on `http://127.0.0.1` / `http://localhost`).
- Existing-session shortcut on `/oauth/authorize`.
- First-time consent screen at `/oauth/consent`, idempotent for previously granted `(user, client, scopes)`.
- `/.well-known/oauth-authorization-server` advertising the endpoints, supported PKCE methods, and supported scopes.
- Settings → Connected apps UI listing active `OAuthGrant`s with revoke.

All of these are line items in the foundation phase of `Implementation phases` below.

### User-facing docs page

Separately from this plan, a short member-facing docs page at e.g. `https://dalios.dartmouth.edu/help/mcp` should cover:

1. **Claude Code** — the `claude mcp add` command + one-line description of what to expect.
2. **Claude Desktop** — the config snippet + restart instruction.
3. **Other clients** — generic "point your MCP-over-HTTP client at `https://dalios.dartmouth.edu/mcp`" with a link to `.well-known` for endpoint discovery.
4. **Managing connections** — link to Settings → Connected apps.

This docs page is a deliverable of the MCP track (phase 15 in `Implementation phases`), not this plan.

## Schema

### `OAuthClient`

```prisma
model OAuthClient {
  id            String   @id @default(cuid())
  // The clientId MCP clients use. Stable, human-readable.
  clientId      String   @unique
  // Display name shown on the consent screen and in Settings.
  name          String
  redirectUris  String[]
  // For loopback native clients (Claude Desktop, Claude Code): match scheme +
  // host on redirectUris, ignore port. RFC 8252.
  isLoopback    Boolean  @default(false)
  // First-party clients (dali-api) skip the consent screen.
  isFirstParty  Boolean  @default(false)
  // Scopes this client is allowed to request.
  allowedScopes String[]
  createdAt     DateTime @default(now())
}
```

Seeded entries:
- `dali-api` — `isFirstParty: true`, redirect `${FRONTEND_URL}/login`, all scopes
- `claude-desktop` — `isLoopback: true`, redirect `http://127.0.0.1/callback`, `mcp:read mcp:write`
- `claude-code` — `isLoopback: true`, redirect `http://127.0.0.1/callback`, `mcp:read mcp:write`

### `OAuthGrant`

Represents a member's standing authorization for a specific client. One row per `(user, client)`. Owns N refresh-token families over time.

```prisma
model OAuthGrant {
  id           String         @id @default(cuid())
  userId       String
  clientId     String          // OAuthClient.clientId
  // Member-supplied or client-supplied label, shown in Settings.
  // Defaults to the client's name on first issuance.
  name         String
  scopes       String[]
  createdAt    DateTime       @default(now())
  lastUsedAt   DateTime?
  revokedAt    DateTime?

  user     User      @relation(fields: [userId], references: [id])
  sessions Session[]

  @@unique([userId, clientId])
  @@index([userId, revokedAt])
}
```

### `Session` (existing — FK constraint added)

The unified `Session` model (see `SESSION_AUTH_PLAN.md` and `prisma/schema.prisma`) already has a nullable `grantId String?` column. This migration just wires up the foreign-key constraint to `OAuthGrant.id` and adds the reverse relation. Null `grantId` means the session was issued by cookie login; non-null means it was issued via `/oauth/token` to a registered MCP client.

Revocation cascades: revoking an `OAuthGrant` runs `session.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: new Date() } })`. The `revokeAllForGrant` helper in `lib/session.ts` is already in place — it just becomes load-bearing once `grantId` is populated.

### `OAuthSession` (existing — no schema change)

Already used for the authorize → callback → exchange round-trip. Extend the row with the requested `scopes` (already-present column reusable, or a new array column) so the consent screen and the issued token know what was asked for.

## Scope vocabulary

**v1 ships with two scopes:**
- `mcp:read` — every read tool
- `mcp:write` — every write tool

Two scopes is enough to give members a meaningful kill switch (read-only token for cautious use) without building the full granularity matrix up front.

**Planned granular scopes** (add when a real need shows up — e.g., a member wants to grant read-projects but not read-mentorship):

| Scope | Coverage |
|---|---|
| `mcp:read:profile` | own profile + Settings preferences |
| `mcp:read:people` | directory, member profiles, eligibility matrix |
| `mcp:read:projects` | project list, workspace, sprints, tasks, comments, partners (project members only) |
| `mcp:read:education` | offerings catalog, own enrollments, session materials |
| `mcp:read:calendar` | own events, free/busy, group memberships |
| `mcp:read:mentorship` | own mentee/mentor list, weekly notes (subject to `isLabMentor` gating) |
| `mcp:read:hiring` | own assigned reviews, applications scoped to own role (subject to per-cycle CA gate) |
| `mcp:write:profile` | edit own profile fields |
| `mcp:write:tasks` | create / update / comment on tasks in projects the user belongs to |
| `mcp:write:calendar` | schedule meetings, RSVP to events |
| `mcp:write:education` | apply / RSVP to offerings, submit assignments |
| `mcp:write:mentorship` | draft (not publish) weekly notes |
| `mcp:write:hiring` | submit review drafts (subject to per-cycle CA gate) |

When granular scopes ship, `mcp:read` becomes an alias for all `mcp:read:*` and `mcp:write` an alias for all `mcp:write:*`. Existing grants migrate cleanly.

**Never exposed via MCP** (high-stakes actions requiring a human in the loop):
- Confirming staffing assignments
- Archiving a project
- Posting a final mentor evaluation (drafts only)
- Granting any role
- Inviting a partner / managing partner access
- Admin Console operations
- Deleting any data

## MCP server architecture

### Transport

**HTTP MCP** (not stdio). One hosted endpoint at `https://dalios.dartmouth.edu/mcp` (or wherever dali-api lives). Members configure their MCP client with that URL and complete the OAuth flow once.

Why HTTP, not stdio:
- Members don't run dali-api locally; stdio would require a per-laptop proxy.
- HTTP works for any MCP client with no per-machine setup.
- Reuses the existing Fly hosting, Prisma client, role helpers, and audit log.

### Routing

```
/.well-known/oauth-authorization-server     OAuth metadata (RFC 8414)
/oauth/authorize                            existing — extended with consent + session shortcut
/oauth/token                                existing — extended with scope-aware tokens
/oauth/revoke                               existing — revokes grant + family
/oauth/consent                              new — first-time per-client confirmation
/mcp                                        new — MCP server endpoint (POST)
```

The MCP server lives in the dali-api app, not a separate Fly service.

### Request flow on `/mcp`

1. MCP client sends an MCP-protocol request with `Authorization: Bearer <session_id>`.
2. `lib/mcp-auth.ts` middleware:
   - Calls `lookupSession(raw)` → SHA-256 hash → indexed PK lookup. Rejects if not found, revoked, or expired.
   - Reads `session.grantId` → resolves the `OAuthGrant` → rejects if revoked.
   - Updates `OAuthGrant.lastUsedAt` and rolls the session (fire-and-forget).
   - Attaches `{ user, scopes, grantId, clientName }` to the request context.
3. The MCP route handler dispatches by tool name.
4. Each tool handler:
   - Checks the required scope is present — rejects otherwise.
   - Resolves role/tier permissions for the user (reuses existing helpers — `requireTier`, scope-bound role checks).
   - Executes via existing app code (Prisma queries, scheduling component, etc.) — no duplicate business logic.
   - Logs an `AuditLog` entry: `{ action: "mcp.tool_called", actorUserId, metadata: { toolName, clientName, grantId, params (redacted) } }`.
   - Returns the MCP-protocol response.

### Tool catalog (v1 cut)

For v1, every read tool below requires `mcp:read`; every write tool requires `mcp:write`. When granular scopes ship, the per-tool scope column populates.

**Read tools:**
| Tool | Granular scope (future) | Description |
|---|---|---|
| `whoami` | (none) | Authenticated user's basic info + tier |
| `list_my_projects` | `mcp:read:projects` | Current-term projects the user is on |
| `get_project` | `mcp:read:projects` | Project detail by id (must be a member) |
| `list_project_members` | `mcp:read:projects` | Roster of a project for a given term |
| `list_project_sprints` | `mcp:read:projects` | Sprints on a project (with status filters) |
| `list_project_tasks` | `mcp:read:projects` | Tasks on a project, optional sprint filter |
| `get_my_tasks` | `mcp:read:projects` | Tasks assigned to me across all my projects |
| `search_directory` | `mcp:read:people` | Member directory search by name / role / project / domain |
| `get_member_profile` | `mcp:read:people` | Full profile for a member id |
| `list_education_offerings` | `mcp:read:education` | Catalog with type / capacity / dates |
| `get_my_enrollments` | `mcp:read:education` | My education applications + status |
| `list_my_meetings` | `mcp:read:calendar` | Upcoming meetings for the user |
| `find_mutual_freebusy` | `mcp:read:calendar` | Free-time intersection for given participants in a window |
| `list_my_mentees` | `mcp:read:mentorship` | Mentees the user is currently mentoring |
| `read_mentor_notes` | `mcp:read:mentorship` | Weekly notes for a mentee (gated by `isLabMentor`) |

**Write tools:**
| Tool | Granular scope (future) | Description |
|---|---|---|
| `create_task` | `mcp:write:tasks` | Create a task on a project the user belongs to |
| `update_task_status` | `mcp:write:tasks` | Move a task to a different status |
| `comment_on_task` | `mcp:write:tasks` | Add a `TaskComment` |
| `schedule_meeting` | `mcp:write:calendar` | Trigger the scheduling component with given participants + window |
| `rsvp_to_event` | `mcp:write:calendar` | Accept / decline a meeting |
| `apply_to_offering` | `mcp:write:education` | Submit an `EducationApplication` (with answers if required) |
| `draft_mentor_note` | `mcp:write:mentorship` | Create a `MentorNote` row in draft state (member must publish from UI) |
| `update_my_profile` | `mcp:write:profile` | Edit own profile fields |

### Tool definitions

Tools register with the MCP server as JSON-schema-typed function definitions. Each handler:
- Validates input against its JSON schema (MCP server does this).
- Checks scope (middleware-level).
- Executes via existing app code — no duplicate logic.
- Returns a typed response.

Files live in `app/mcp/tools/<area>.ts` (one file per area: projects, people, education, calendar, etc.).

## Settings UI

Lives at **Settings > Connected apps** (a sub-section of the broader Settings page from `expansion_plan.md`).

**Member view:**
- List of active `OAuthGrant`s: client name, scopes (chips), `createdAt`, `lastUsedAt`, **Revoke** button.
- No "create token" affordance — grants are created exclusively through the OAuth flow initiated by the MCP client. The member doesn't see or handle raw tokens.
- Revoke action: confirmation modal → sets `OAuthGrant.revokedAt`, calls `revokeAllForGrant` to cascade to every `Session` row tied to that grant.
- Help link: **"How to connect Claude to DALI OS"** (separate doc with MCP-client config snippets).

## Implementation phases

The OAuth extensions are independently shippable and useful on their own — the existing-session shortcut helps any future third-party client, and Bearer-token acceptance is useful for any non-cookie API call. Order them before the MCP server itself.

### Foundation (extends `/oauth/*`)

1. **`OAuthClient` model + migration + seed.** Replace the hardcoded `VALID_CLIENT_IDS` array with a DB lookup. No external behavior change.
2. **Per-client redirect URIs + loopback matching.** `getAllowedRedirectUris` becomes per-client. Loopback rule for `isLoopback` clients.
3. **Existing-session shortcut on `/oauth/authorize`.** If a valid dali-os session cookie is present, skip the Google/CAS bounce.
4. **Bearer-token acceptance in `requireAuth`.** Accept `Authorization: Bearer <jwt>` in addition to the existing cookie.
5. **Scope plumbing.** `scope` param → `OAuthSession.scopes` → access-token claim. Reject scope values not in the client's `allowedScopes`.
6. **`OAuthGrant` model + consent screen.** `/oauth/consent` route; first-time per-`(user, client, scopes)` confirmation; subsequent flows auto-approve.
7. **`/.well-known/oauth-authorization-server`.**
8. **Settings > Connected apps UI.** List + revoke.

### MCP track

9. **`lib/mcp-auth.ts`** — middleware: `lookupSession` → resolve grant, check scopes, attach context, fire-and-forget `rollSession`.
10. **`/mcp` route** — MCP server endpoint, dispatches by tool name.
11. **Read tools** — implement the read-scope tool catalog (one PR per area or one large PR).
12. **Audit log integration** — every tool call logs to `AuditLog`.
13. **Rate limiting** — per-grant quotas (reuse existing `lib/rate-limit.ts`).
14. **Write tools** — implement the write-scope tool catalog (separate PRs per area).
15. **Member documentation** — "How to connect Claude to DALI OS" with sample MCP-client config.

Rough sizing: foundation (1–6) is 3–5 focused days. MCP read-only v1 (9–13) is another 1 week. Writes (14) are another 1 week if pursued.

## Security considerations

- **Access tokens are bearer credentials.** Never log them. JWTs are short-lived (15 min) and self-contained; revoking the grant invalidates them as soon as the access token expires (or sooner — the middleware looks up the grant on every request).
- **Refresh tokens are bearer credentials.** Stored only as SHA-256 hashes. Sliding 7-day expiry, 30-day absolute cap, family-based reuse detection (existing behavior). Revoking a grant cascade-revokes every refresh token in it.
- **Audit every tool call.** AI assistants don't always do what users expect; the audit log is the forensics trail. Include `clientName` and `grantId` so a misbehaving client is traceable.
- **Rate limit per grant** to bound runaway-loop damage from a misbehaving AI client.
- **Lab-mentor-collective gate** (`isLabMentor`) still applies even with `mcp:read:mentorship`. Non-mentors get nothing.
- **Per-cycle CA gating** still applies to hiring tools — `requireApiSignedOrForbidden` runs before any hiring data is returned.
- **Loopback URI validation:** for `isLoopback` clients, the redirect URI must match scheme `http`, host `127.0.0.1` or `localhost`, ignoring port — anything else is rejected. No `0.0.0.0`, no public-IP loopback claims.
- **State + PKCE remain mandatory.** State for CSRF, PKCE for code-interception. Both already enforced.
- **First-party flag isn't a backdoor.** Only the seeded `dali-api` client gets `isFirstParty: true`; the seed migration is the only path to setting it.
- **No partners, no alumni, no public.** A `User.tier` check at the start of `/oauth/authorize` rejects anyone outside members + Core when the client is an MCP client.

## Open questions

1. **Killer use case** — drives which tools to prioritize. Best guess: scheduling. Confirm before the track kicks off.
2. **Read-only v1 only, or include writes?** Read-only is safer and shippable in ~1 week. Writes layer on after.
3. **Granular scopes timing** — ship v1 with `mcp:read` / `mcp:write` only, or front-load the full `mcp:<area>:<verb>` vocabulary? Default: ship coarse, add granular when a concrete request shows up.
4. **Loopback port handling for the consent screen.** When the consent screen redirects back, the loopback port is dynamic. Either render the redirect URL server-side (preferred — the port came in on the authorize request) or have the client poll. No issue, just specify the choice during impl.
5. **Should there be a "DALI assistant"** — a curated agent built on top of the MCP server, hosted by DALI for non-technical members? Future product question. Out of scope for the MCP server itself.

## Why this lives in its own doc

The MCP feature is genuinely separable from the rest of the expansion plan:
- Different audience (members who use AI assistants — a subset).
- Different priority (post-v0).
- Different integration points (auth extensions + a separate server, not feature surfaces).
- Could ship significantly later without affecting any other track.

Cross-references in `expansion_plan.md` should point here when MCP comes up. No schema changes are required in v0 — every model in this doc lands with the MCP track.
