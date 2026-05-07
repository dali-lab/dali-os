# DALI OS MCP Plan

**Status:** Low priority. Ships post-v0 of the broader expansion plan (see `expansion_plan.md`). One small schema addition (`PersonalAccessToken`) lands with v0; the MCP server itself is its own track.

## Context

DALI OS exposes an **MCP (Model Context Protocol) server** so AI assistants — Claude Desktop, Claude Code, and any other MCP-compatible client — can interact with DALI OS data on a member's behalf.

The use case: a lab member is working in Claude and wants to ask "who's on Project Alpha right now?" or "schedule a 30-minute weekly with my Project Alpha team starting next week" without leaving their AI assistant. The MCP server makes DALI OS one of the AI's tools.

**Why this is low priority:** it's a quality-of-life integration, not a core lab workflow. Members can use the DALI OS UI directly. MCP is leverage on top of an already-working platform — ship after the platform exists.

## Auth model

### v1: Personal Access Tokens (PAT)

Member generates a long-lived bearer token in Settings, names it ("Claude Desktop on my laptop"), selects scopes, and pastes the token into their MCP client config.

**Why PAT and not OAuth:** the existing `lib/oauth.ts` is a single-client first-party auth broker (only `client_id=dali-api` is allowed; only one redirect URI). It is **not** a general-purpose multi-tenant OAuth provider, despite the name. Extending it to support third-party MCP clients (multi-client registry, multi-redirect-URI, scopes, consent screen) is 1–2 weeks of focused work — not justified for a low-priority feature.

PAT ships in 2–3 days, reuses existing patterns (token hashing matches `RefreshToken.tokenHash`), and is **OAuth-upgradeable** later — the scope vocabulary, audit log conventions, and MCP server endpoints don't change when the auth method swaps.

### Future: OAuth-based MCP

Eventually — when the existing OAuth provider grows multi-tenant support (its own track, triggered by a second real use case), MCP migrates from PAT to OAuth. PAT stays around for backward compat / power users who prefer it.

The migration path:
- MCP server's auth middleware (`lib/mcp-auth.ts`) starts with one branch (PAT lookup), gains a second (OAuth bearer token lookup) when OAuth lands
- Same scope vocabulary
- Same audit log conventions (token name → client name)
- Settings UI gains an "Authorized clients" section alongside "Personal access tokens"

No PAT-era data needs migrating; the two coexist.

## Schema

### `PersonalAccessToken`

Lands in v0 (small, low-risk, future-proofs the MCP track).

```prisma
model PersonalAccessToken {
  id          String    @id @default(cuid())
  userId      String
  // Human label so members can identify which client uses which token.
  name        String
  // Stored as SHA-256 hash; raw token is shown to the member exactly once
  // on creation. Same hashing convention as RefreshToken.tokenHash.
  tokenHash   String    @unique
  // Scope vocabulary defined in this doc. Empty array = no access.
  scopes      String[]
  createdAt   DateTime  @default(now())
  lastUsedAt  DateTime?
  expiresAt   DateTime?  // optional; null = no expiry
  revokedAt   DateTime?

  user User @relation(fields: [userId], references: [id])

  @@index([userId, revokedAt])
}
```

**Notes:**
- `tokenHash` indexed for O(1) lookup at request time
- `lastUsedAt` updated on every use (best-effort; not transactional with the request)
- Revoke is soft (sets `revokedAt`), not delete — preserves audit trail

### Reverse relation on `User`

```prisma
personalAccessTokens  PersonalAccessToken[]
```

## Scope vocabulary

Scope strings follow `<area>:<verb>:<resource>` convention. Verbs are `read` or `write`. Areas group related resources.

**Read scopes:**
- `mcp:read:profile` — own profile + Settings preferences
- `mcp:read:people` — directory, member profiles, eligibility matrix
- `mcp:read:projects` — project list, workspace, sprints, tasks, comments, partners (members-of-the-project only)
- `mcp:read:education` — offerings catalog, own enrollments, session materials
- `mcp:read:calendar` — own events, free/busy, group memberships
- `mcp:read:mentorship` — own mentee/mentor list, weekly notes (subject to `isLabMentor` gating)
- `mcp:read:hiring` — own assigned reviews, applications scoped to own role (subject to per-cycle CA gate)
- `mcp:read:tasks` — own tasks across projects (subset of `mcp:read:projects` for convenience)

**Write scopes:**
- `mcp:write:profile` — edit own profile fields
- `mcp:write:tasks` — create / update / comment on tasks in projects the user belongs to
- `mcp:write:calendar` — schedule meetings via the scheduling component, RSVP to events
- `mcp:write:education` — apply / RSVP to offerings, submit assignments
- `mcp:write:mentorship` — draft (NOT publish) weekly notes
- `mcp:write:hiring` — submit review drafts (subject to per-cycle CA gate)

**Never exposed via MCP** (high-stakes actions that require a human in the loop):
- Confirming staffing assignments
- Archiving a project
- Posting a final mentor evaluation (drafts only)
- Granting any role
- Inviting a partner / managing partner access
- Admin Console operations
- Deleting any data

**Default scope set on token creation:** all `mcp:read:*` for the user's tier. Members opt into write scopes deliberately.

## MCP server architecture

### Transport

**HTTP MCP** (not stdio). One hosted endpoint at `https://dalios.dartmouth.edu/mcp` (or wherever the dali-api lives). Members configure their MCP client with that URL + their PAT.

**Why HTTP, not stdio:**
- Members don't run dali-api on their laptop; stdio would require a local proxy
- HTTP works for any MCP client without per-machine setup
- DALI OS already has Fly hosting; reusing the same app is trivial

### Routing

```
/mcp                    MCP server endpoint (POST)
                        Bearer token in Authorization header → resolved to PAT → user
```

Lives in the dali-api app (new route prefix), not a separate Fly service. Reuses the existing Prisma client, role helpers, audit log, etc.

### Request flow

1. MCP client sends MCP-protocol request with `Authorization: Bearer <pat>`
2. `lib/mcp-auth.ts` middleware:
   - Look up `PersonalAccessToken` by `tokenHash = sha256(pat)`
   - Reject if not found, revoked, or expired
   - Update `lastUsedAt` (fire-and-forget)
   - Attach `{ user, scopes }` to the request context
3. MCP route handler dispatches by tool name
4. Each tool handler:
   - Checks the required scope is in `request.context.scopes` — reject otherwise
   - Resolves the tier / scope-bound permissions for the user (same `requireTier` / `requireScope` helpers as the rest of the app)
   - Executes the operation (Prisma query / mutation)
   - Logs an `AuditLog` entry: `{ action: "mcp.tool_called", actorUserId, metadata: { toolName, tokenName, params (redacted) } }`
   - Returns the MCP-protocol response

### Tool catalog (rough cut for v1)

Enumerated here so the team can scope; concrete tool schemas come during implementation.

**Read tools:**
| Tool | Scope | Description |
|---|---|---|
| `whoami` | (no scope) | Returns the authenticated user's basic info + tier |
| `list_my_projects` | `mcp:read:projects` | Current-term projects the user is on |
| `get_project` | `mcp:read:projects` | Project detail by id (must be a member) |
| `list_project_members` | `mcp:read:projects` | Roster of a project for a given term |
| `list_project_sprints` | `mcp:read:projects` | Sprints on a project (with status filters) |
| `list_project_tasks` | `mcp:read:tasks` | Tasks on a project, optional sprint filter |
| `get_my_tasks` | `mcp:read:tasks` | Tasks assigned to me across all my projects |
| `search_directory` | `mcp:read:people` | Member directory search by name / role / project / domain |
| `get_member_profile` | `mcp:read:people` | Full profile for a member id |
| `list_education_offerings` | `mcp:read:education` | Catalog with type / capacity / dates |
| `get_my_enrollments` | `mcp:read:education` | My education applications + status |
| `list_my_meetings` | `mcp:read:calendar` | Upcoming meetings for the user |
| `find_mutual_freebusy` | `mcp:read:calendar` | Free-time intersection for given participants in a window |
| `list_my_mentees` | `mcp:read:mentorship` | Mentees the user is currently mentoring |
| `read_mentor_notes` | `mcp:read:mentorship` | Weekly notes for a mentee (gated by `isLabMentor`) |

**Write tools (require explicit scope opt-in):**
| Tool | Scope | Description |
|---|---|---|
| `create_task` | `mcp:write:tasks` | Create a task on a project the user belongs to |
| `update_task_status` | `mcp:write:tasks` | Move a task to a different status |
| `comment_on_task` | `mcp:write:tasks` | Add a `TaskComment` |
| `schedule_meeting` | `mcp:write:calendar` | Trigger the scheduling component with given participants + window |
| `rsvp_to_event` | `mcp:write:calendar` | Accept / decline a meeting |
| `apply_to_offering` | `mcp:write:education` | Submit an `EducationApplication` (with answers if required) |
| `draft_mentor_note` | `mcp:write:mentorship` | Create a `MentorNote` row in draft state (member must publish from UI) |
| `update_my_profile` | `mcp:write:profile` | Edit own profile fields |

**Never exposed:** see "Never exposed via MCP" in the scope section.

### Tool definitions

Tools are registered with the MCP server as JSON-schema-typed function definitions. Each tool's handler:
- Validates input against its JSON schema (MCP server does this)
- Checks scope (middleware-level)
- Executes via existing app code (Prisma queries, scheduling component, etc.) — no duplicate logic
- Returns a typed response

Tool definitions live in `app/mcp/tools/<area>.ts` (one file per area: projects, people, education, calendar, etc.).

## Settings UI

Lives at **Settings > MCP / API Tokens** (a sub-section of the broader Settings page from `expansion_plan.md`).

**Member view:**
- List of existing PATs: name, scopes (chips), createdAt, lastUsedAt, revoke button
- "Generate new token" button → modal:
  - Name input
  - Scope checkboxes grouped by area (read scopes default-checked; write scopes opt-in)
  - Optional expiry (presets: 30 days / 90 days / 1 year / never)
  - Submit → shows the raw token exactly once with a copy button + warning ("save this now — you won't see it again")
- Revoke action: confirmation modal → sets `revokedAt`

**Documentation link:** "How to connect Claude to DALI OS" (separate doc — sample MCP config snippets for Claude Desktop and Claude Code).

## Implementation phases

### v0 deliverables (lands with the broader v0 migration)

- `PersonalAccessToken` Prisma model
- (Nothing else — actual MCP server is post-v0)

### MCP track (post-v0, low priority)

1. **`lib/mcp-auth.ts`** — middleware: SHA-256 lookup, scope attach, lastUsedAt update, reject revoked/expired
2. **`/mcp` route** — MCP server endpoint, dispatches to tools by name
3. **Read tools first** — implement the read-scope tool catalog above (one PR per area or one big PR, depending on the dev's preference)
4. **Settings UI for PAT management** — list, create, revoke
5. **Audit log integration** — every tool call logs
6. **Write tools** — implement the write-scope tool catalog (separate PR per area)
7. **Documentation** — "How to connect Claude to DALI OS" with sample config snippets
8. **Rate limiting** — per-token quotas (reuse existing `lib/rate-limit.ts`)

Reasonable size: 1–2 weeks for read-only v1; another 1–2 weeks for writes if pursued.

## Security considerations

- **Tokens are bearer credentials.** Treat as passwords. Never log raw tokens. Show only once at creation.
- **Tokens grant the user's full effective permissions** (constrained only by the granted scopes). A revoked or compromised token can read everything in scope until revoked.
- **Audit every tool call.** AI assistants don't always do what users expect; the audit log is the forensics trail.
- **Rate limit per token** to prevent runaway loops in misbehaving AI clients.
- **Don't expose mentor notes by default.** Even with `mcp:read:mentorship`, the lab-mentor-collective gate (`isLabMentor`) still applies — non-mentors can't read.
- **Per-cycle CA gating still applies** to hiring tools — the existing `requireApiSignedOrForbidden` check runs before any hiring data is returned.
- **Partner / Alumni scope:** out of scope for v1. Only members + Core can generate PATs.
- **Token rotation:** members should rotate tokens periodically. UI can show "this token hasn't been used in 90 days — consider revoking" hints.

## Open questions

1. **Killer use case** — what's the one thing members would most want to do via Claude? Drives which tools to prioritize. Best guess: scheduling. Confirm before the track kicks off.
2. **Read-only v1 only, or include writes?** Read-only is much safer and shippable in 1–2 weeks. Writes layer on after.
3. **Lab-internal only, or partners/alumni eventually?** Partners with PATs could ask "what's the status of our project?" via Claude. Alumni tokens probably make less sense. v1 is members + Core only.
4. **Tool input validation:** rely on MCP's JSON schema, or layer additional Zod schemas? Probably JSON schema is enough.
5. **Should there be a "DALI assistant" — a curated agent built on top of the MCP server**, hosted by DALI for non-technical members? Future product question. Out of scope for the MCP server itself.

## Why this lives in its own doc

The MCP feature is genuinely separable from the rest of the expansion plan:
- Different audience (lab members who use AI assistants — a subset)
- Different priority (low)
- Different integration points (auth + a separate server, not feature surfaces)
- Could ship significantly later without affecting any other track

Cross-references in `expansion_plan.md` should point here when MCP comes up. The `PersonalAccessToken` model is the only schema touchpoint that needs to land in v0.
