# MCP Expansion Plan

**Status:** Planning · **Date:** 2026-08-04 · **Owner:** Kiran

The app has outgrown its MCP surface. The MCP server exposes ~70 tools clustered
around project-hub + personal productivity, while whole product surfaces (hiring,
education, partners, mentorship, signing, forms, most of admin, lab-wide docs,
comments, search) have zero MCP coverage. This plan audits the full route surface,
locks the design decisions, and phases the build.

MCP is also the **data backbone for the mobile app** (sidekick app pulls data via
an MCP proxy). That makes *read completeness* the first priority — the mobile app
needs `list_*`/`get_*` everywhere before it needs writes.

---

## 1. Current state (as of 2026-08-04)

- **Transport:** hand-rolled JSON-RPC 2.0 at `POST /mcp` (`app/routes/mcp.ts`, 1,228 lines). No `@modelcontextprotocol/sdk` dependency.
- **Catalog:** 70 tools, 5 resources (3 static + 2 templated), 6 prompts.
- **Auth:** OAuth grant → two scopes only, `mcp:read` / `mcp:write` (`ALLOWED_SCOPES` in `app/routes/oauth.register.ts`). Per-tool `requiredScope`. Role checks done *inside* each tool via `app/mcp/tools/access.ts` + `~/lib/roles`.
- **Tool shape:** each `app/mcp/tools/*.ts` exports `NAME_TOOL` (`{ name, description, inputSchema, requiredScope }`) + a `run*(userId, args)` fn + typed error classes.
- **Validator:** `app/lib/mcp-input.ts` — flat JSON-Schema subset (`type`, `properties`, `required`, `enum`, min/max…). **No `if/then`/`oneOf`/`anyOf`.**
- **Docs:** `app/routes/help.mcp.tsx` is a **hand-maintained** tool list — already drifted from the real catalog.

### The three structural problems

1. **Monolithic registration.** Adding one tool edits four places in `mcp.ts`: import, `TOOLS` array, `tools/call` switch case, and `rpcErrorFromTool`. Does not scale to +70 tools.
2. **Coarse scopes.** `mcp:write` currently grants "create a task" and would equally grant "run payroll" or "broadcast to the lab." Needs a risk tier.
3. **Catalog size.** Naive gap = ~160 new tools → ~220 total, which hurts model tool-selection and context budget. Must consolidate.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | **Scope model** | Risk tiers: `mcp:read` / `mcp:write` / **`mcp:admin`** (new). Two-axis: scope = client blast radius; internal role gate = whether the user may act. |
| D2 | **Hiring** | **Read-only over MCP.** No hiring write/admin tools, ever. Hiring reads under `mcp:read`, internally gated (reviewer/domain-lead/Core see only what they're allowed to). |
| D3 | **Granularity** | Hybrid: reads + high-frequency member writes stay **discrete**; long-tail admin/CRUD writes are **faceted** (`manage_*(action, …)`). |
| D4 | **Existing tools** | Facet the over-granular write CRUD clusters; keep old names as **deprecated aliases** (no client breakage). |
| D5 | **First wave** | **Read completeness** (mobile backbone) + **member docs/comments/notes + search**. |

---

## 3. Authorization model (two-axis)

**Axis 1 — OAuth scope** (what the *client* is trusted with; shown on the consent screen):

- `mcp:read` — all reads. **Reads are always permission-filtered per user** — `mcp:read` never means "read everything," it means "read what this user can see."
- `mcp:write` — the user's own work + **role-scoped duties**: PM task management, instructor grading, mentor notes, staffing-board edits, member sign/submit. Normal job work, not administration.
- `mcp:admin` — **elevated / high-blast-radius** actions only. An action needs `mcp:admin` iff it: provisions or revokes access, changes roles or money, messages people outside the app, or is irreversible at scale.

**Axis 2 — internal role gate** (whether *this user* may act): always enforced in `run()` via `access.ts` helpers, independent of scope. Extend `access.ts` with the gates the new areas need: `isInstructorFor(offeringId)`, `canViewCycle(cycleId)` / `isReviewerFor` / `isDomainLead`, `isMentor` / `canViewMentorship`, `canManageStaffing` (exists), `isCore` / `isAdmin` (exist).

Dividing line, by example:

| Action | Scope | Internal gate |
|---|---|---|
| Read anything (tasks, applicants, payroll numbers) | `mcp:read` | per-resource visibility filter |
| Submit a review, grade, mentor note, staffing-board edit | `mcp:write` | reviewer / instructor / mentor / canManageStaffing |
| Member: sign a doc, submit a form, apply to an offering | `mcp:write` | the member themselves |
| Finalize staffing (provisions Slack/GitHub/Gmail) | `mcp:admin` | canManageStaffing |
| Broadcast announcement, payroll, role grant, job control, delete domain, activate agreement, close-out offering (issues certs + emails) | `mcp:admin` | Core / Admin |

> **Hiring note (D2):** hiring is entirely `mcp:read`. Reviews, decisions, delibs, interviews, waitlist actions are **not** exposed — humans click those buttons. Claude/mobile can read cycle state, applicant context, coverage, and rosters.

**Registration changes:** add `"mcp:admin"` to `ALLOWED_SCOPES`; add its description to `SCOPE_DESCRIPTIONS` in `oauth.consent.tsx` ("Perform elevated actions — payroll, roles, jobs, broadcasts, provisioning"); dynamic-registration clients get all three offered, request the subset they need.

**How `mcp:admin` is granted (decided):** *role-gated consent.* Any client may request `mcp:admin`, but the OAuth consent flow only **grants** it when the consenting user is Core/Admin — otherwise it's silently dropped from the granted scope set and the consent screen hides the admin row. On top of that, every admin tool re-checks `isCore`/`isAdmin`/`canManageStaffing` in `run()` on every call (defense in depth), so the scope is inert without the live role. Two independent fail-closed gates: **scope = client trust** (user consented to let this client attempt admin actions), **role = user authority** (this user may actually perform it). Role is re-checked per call, so losing Core makes an existing admin grant inert on the next call — no stale privilege.

---

## 4. Architecture foundation — Wave 0 (must precede scale)

### 4.1 Tool registry (kills the monolith)

Replace the four-touch-points pattern with a self-describing registry entry:

```ts
// app/mcp/registry.ts
export type McpTool = {
  def: { name: string; description: string; inputSchema: JsonSchema; requiredScope: Scope };
  run: (ctx: McpCtx, args: Record<string, unknown>) => Promise<unknown>;
  errorMap?: (err: unknown) => { code: number; message: string } | null;
  aliasOf?: string;   // deprecated-alias support (D4)
};
export const TOOLS: McpTool[] = [ /* imported per area */ ];
```

`mcp.ts` becomes a thin dispatcher: look up by name → scope check → `validateInput` → `run(ctx, args)` → audit log → wrap result; centralized error mapping via each tool's `errorMap` (fallback to a shared `status → JSON-RPC code` map). `McpCtx` carries `{ user, scopes, request }` so tools stop taking bare `userId`. Same for resources/prompts (registry arrays already 90% there).

### 4.2 `mcp:admin` scope — see §3.

### 4.3 Faceting infrastructure

Faceted tools use `action: { enum: [...] }` + shared fields. Because the validator is flat (no `if/then`), add a tiny helper:

```ts
// per-action required-field enforcement in run(), or extend validateInput
requireForAction(action, args, { create: ["title", "startTime"], update: ["id"], delete: ["id"] })
```

Prefer the helper over teaching the validator `if/then` (smaller blast radius). Every faceted tool documents its actions in the description.

### 4.4 Auto-generated docs

Generate `help.mcp` tool list + a machine catalog (`GET /mcp` capabilities, or a `dali://catalog` resource) **from the registry**, so the docs can never drift again. Delete the hand-maintained list.

### 4.5 Conventions doc

Short `app/mcp/README.md`: how to add a tool (discrete vs faceted decision rule), scope-tagging rule, internal-gate rule, error-class convention, test convention (one spec per tool/cluster), audit-logging (inherited by dispatcher — tools should still keep their own `logAuditEvent` for domain events).

---

## 5. Existing-tool refactor (faceting + aliases)

Facet the write CRUD clusters (shared entity fields; differ only in required-ness). Keep `list_*` reads discrete. **Old names retained as deprecated aliases** → same faceted handler, removed after a deprecation window.

| Cluster | Today (n) | After | Δ |
|---|---|---|---|
| Sprints | `list`+`create`/`update`/`set_status`/`delete` (5) | `list_sprints` + `manage_sprint(action)` | −3 |
| Epics | `list`+`create`/`update`/`delete` (4) | `list_epics` + `manage_epic(action)` | −2 |
| Stories | `create`/`update`/`delete` (3) | `manage_story(action)` | −2 |
| Time entries | `list`+`add`/`update`/`delete` (4) | `list_my_time_entries` + `manage_time_entry(action)` | −2 |
| Manual blocks | `list`+`add`/`update`/`delete` (4) | `list_my_manual_blocks` + `manage_manual_block(action)` | −2 |
| Doc/file curation | `list_sharing`+4 writes (5) | `list_document_sharing` + `manage_document_sharing(action)` | −3 |
| Task status | `update_task` + `update_task_status` (2) | fold status into `update_task` | −1 |

**Net ≈ −15** (70 → ~55), offsetting new additions.

**Keep discrete:** all `list_*`/`get_*`, tasks (create/update/delete/get + comment/checklist/github — daily driver), pages, meetings, notifications, staffing, showcase, `create_project`, `whoami`, `search_directory`.

**Tradeoff accepted:** faceted tools lose declarative per-action `required` enforcement (moves to `requireForAction` in the handler). Worth it for the write clusters; not worth it for reads/high-frequency tools.

---

## 6. New-tool inventory by area

Kind: **R** read · **W** role-scoped write · **A** admin · **F** faceted. Scope in parens.

### 6.1 Hiring — READ ONLY (D2), scope `mcp:read`, gate = canViewCycle/role
| Tool | Kind | Notes |
|---|---|---|
| `list_hiring_cycles` | R | cycles + status |
| `get_hiring_cycle` | R | status + interview config + coverage summary |
| `list_applications` | R | by cycle/domain/status (reviewer sees own domains) |
| `get_application` | R | full context: answers, reviews, decisions, interviews, rubric |
| `list_waitlist` | R | active waitlisted across cycles (Core) |
| `get_delibs_session` | R | deliberation board state |

### 6.2 Education — reads (`mcp:read`) + writes (`mcp:write`, instructor/student gate); close-out is `mcp:admin`
| Tool | Kind | Scope | Notes |
|---|---|---|---|
| `list_education_offerings` | R | read | catalog + my enrollment status |
| `get_education_offering` | R | read | sessions, instructors, window, capacity |
| `list_my_education_applications` | R | read | across offerings |
| `get_education_assignment` | R | read | + my submission + feedback |
| `get_ce_credit_standing` | R | read | current-term compliance |
| `submit_education_application` | W | write | apply / resubmit / RSVP (self) |
| `withdraw_education_application` | W | write | self |
| `manage_education_offering` | F/W | write | action: create·update·set_status·set_instructors·delete (instructor/Core) |
| `manage_education_session` | F/W | write | action: add·update·delete·generate_series |
| `manage_education_assignment` | F/W | write | action: create·update·delete |
| `decide_education_application` | W | write | approve/reject/waitlist (+ bulk approve-pending) |
| `save_education_attendance` | W | write | roster → CE-credit sync |
| `upsert_education_student_note` | W | write | **feedback lane only** (student-visible); never the hiring-only internal lane |
| `close_out_education_offering` | A | **admin** | issues certs + grants CE + sends emails |

### 6.3 Partners (internal /partners), Core gate; `mcp:write`, promote = `mcp:admin`
| Tool | Kind | Scope | Notes |
|---|---|---|---|
| `list_partner_orgs` / `get_partner_org` | R | read | orgs, members, projects, applications |
| `list_partner_applications` / `get_partner_application` | R | read | pipeline + scope |
| `manage_partner_org` | F/W | write | action: create·update·delete |
| `manage_partner_member` | F/W | write | action: invite·revoke·set_role·move·remove |
| `manage_partner_application` | F/W | write | action: create·update_status·update_details·set_form·add_domain·update_domain_scope |
| `promote_partner_application` | A | **admin** | creates Project + initial staffing requests |
| `manage_partner_project_link` | F/W | write | action: link·end·unlink |

### 6.4 Member docs / comments / notes / search — **WAVE 1** (D5)
| Tool | Kind | Scope | Notes |
|---|---|---|---|
| `search` | R | read | global ⌘K search, permission-scoped |
| `list_comments` | R | read | threads on a doc/file/page-doc |
| `manage_comment` | F/W | write | action: create·edit·resolve·reopen·react·unreact·delete |
| `list_lab_documents` | R | read | lab-wide pages visible to user |
| `create_lab_document` / `delete_lab_document` | W | write | (or reuse page tools scoped to Lab workspace) |
| `list_personal_notes` / `get_personal_note` | R | read | own + shared |
| `manage_personal_note` | F/W | write | action: create·update·delete·set_visibility·share_add·share_remove |
| `manage_page` | F/W | write | action: pin·move·duplicate·favorite·set_template |
| `list_doc_tags` / `apply_doc_tag` | R/W | read/write | tag create is Core (`mcp:admin`) |
| `list_collab_versions` / `get_collab_version` / `restore_collab_version` | R/R/W | read/read/write | version history |

### 6.5 Calendar / attendance / profile
| Tool | Kind | Scope | Notes |
|---|---|---|---|
| `list_scheduled_meetings` | R | read | no list endpoint today (create exists) |
| `get_meeting_attendance` | R | read | roster |
| `check_in_to_meeting` | W | write | self check-in within grace window |
| `get_group_availability` | R | read | free slots for a group |
| `get_google_calendar_busy` | R | read | own busy blocks |
| `update_profile` | W | write | name, pronouns, bio, handle, timezone, photo (self) |

### 6.6 Mentorship — mentor/Core gate
| Tool | Kind | Scope | Notes |
|---|---|---|---|
| `list_mentor_notes` / `get_mentor_note` | R | read | **not visible to mentees** |
| `manage_mentor_note` | F/W | write | action: upsert·set_vibe·delete (body via collab pipeline) |
| `list_mentorship_pairs` / `manage_mentorship_pair` | R / F/W | read/write | pair create/delete (Core) |
| `list_mentor_note_templates` / `manage_mentor_note_template` | R / F/W | read / **admin** | template edits are Core |

### 6.7 Signing
| Tool | Kind | Scope | Notes |
|---|---|---|---|
| `list_documents_to_sign` / `get_signed_document` | R | read | member inbox |
| `sign_document` | W | write | records signature (member) |
| `manage_agreement` | F/A | **admin** | action: create·rename·publish·activate·countersign (field-placement stays UI) |
| `list_agreement_signatures` | R | read | roster (Core) |

### 6.8 Forms
| Tool | Kind | Scope | Notes |
|---|---|---|---|
| `list_forms` / `get_forms_folder` / `get_form_responses` | R | read | Core (responses paginated; CSV export stays a route) |
| `submit_form` | W | write | member, public-token addressed |
| `manage_form` | F/A | **admin** | action: create·save_version·save_draft·publish·unpublish·set_window·set_audience·set_settings·rename·move·duplicate·delete |
| `manage_forms_folder` | F/A | **admin** | action: create·rename·move·delete |

### 6.9 Admin / operations — mostly `mcp:admin`
| Tool | Kind | Scope | Notes |
|---|---|---|---|
| `list_domains` | R | read | complements `list_terms` |
| `send_announcement` | A | **admin** | lab/group/user broadcast + todo/dueAt/formId/schedule |
| `manage_group` | F/A | **admin** | action: create·update·delete (Static only) |
| `manage_domain_lead` | F/A | **admin** | action: add·remove (term-scoped) |
| `list_audit_logs` | R | **admin** | Core-only read → `mcp:admin` (sensitive read) |
| `manage_job` | F/A | **admin** | action: set_config·run |
| `list_email_senders` / `list_email_templates` | R | **admin** | audit surfaces |
| `manage_email_template` | F/A | **admin** | action: create·update |

**Excluded from admin (stay UI/route-only):** payroll upload/export/budget (bulk PII + CSV), Gmail OAuth authorize (human-bound token dance), member **role grants** (`api.members.$memberId.roles` — highest risk; leave on the web with its promotion notification), domain create/delete (structural).

### 6.10 Projects / staffing — remaining gaps
| Tool | Kind | Scope | Notes |
|---|---|---|---|
| `update_project` | W | write | project settings write (paired with existing `get_project_settings`) |
| `manage_staffing` | F/W | write | action: set_mentor_role·add_external_mentor·remove_external_mentor·add_board_member·remove_board_member |
| `finalize_staffing` | A | **admin** | provisions Slack/GitHub/Gmail — high blast |
| `correct_assignment_level` | A | **admin** | Core post-finalize fix |
| `manage_task_files` | F/W | write | action: link·unlink (task↔ProjectFile artifacts) |
| `set_page_visibility` | F/W | write | action: partner·public |
| `set_file_partner_visibility` | W | write | mirrors page visibility |

**Stay excluded:** SSE streams (`api.staffing.events`, notifications/comments streams), GitHub webhook, `sync-teams`/`term-channel` (bulk external provisioning), drag-only reorder endpoints, all CSV/PDF exports.

---

## 7. Phased rollout

| Wave | Content | Scope tiers touched |
|---|---|---|
| **0 — Foundation** | Tool registry + thin dispatcher; add `mcp:admin` scope + consent; faceting infra (`requireForAction`); auto-gen docs; conventions README; **facet existing write clusters + aliases (§5)** | infra |
| **1 — Reads + daily collab** (D5) | All `list_*`/`get_*` across hiring, education, partners, calendar, `list_domains`; `search`; comments suite; personal notes; lab docs; `manage_page`; doc tags; collab versions; `update_profile` | read + write |
| **2 — Member role-scoped writes** | Education (student apply/withdraw/submit + instructor manage/decide/attendance/notes); mentorship notes/pairs; `sign_document`; `submit_form`; `manage_staffing` (non-provisioning); `manage_task_files`; page/file visibility; `update_project` | write |
| **3 — Admin (`mcp:admin`)** | `send_announcement`; `manage_group`; `manage_domain_lead`; `list_audit_logs`; `manage_job`; `finalize_staffing`; `correct_assignment_level`; `manage_agreement`; `close_out_education_offering`; `promote_partner_application`; partner-admin + forms-admin faceted writes; email-template/sender reads | admin |

Hiring reads land in Wave 1; **no hiring writes in any wave** (D2).

Rough end-state: ~55 (refactored existing) + ~70 (new) ≈ **125 tools**, vs ~220 naive — kept in check by faceting + hiring-read-only + admin exclusions.

---

## 8. Cross-cutting caveats

- **CRDT / collab writes.** Any tool touching a doc *body* (comments are rows — fine; but personal-note bodies, mentor-note `contentJson`, education pages, signing frozen body) must go through the existing collab pipeline (`app/collab/persistence.ts` / `read.ts`), never a raw Y.Doc decode. `set_page_content` is the reference implementation. Flag collab-touching tools in the PR (per CLAUDE.md).
- **Outbound side-effects.** `send_announcement`, `close_out_education_offering`, `sign_document` (counter-sign notifications), `finalize_staffing` all fan out email/Slack/notifications. Make handlers idempotent; consider a `confirm: true` guard on the highest-blast ones. Applicant/partner transactional email stays on its direct pipelines (outside the preference layer) per CLAUDE.md.
- **Reads are filtered, not open.** Every read tool applies the same per-user visibility the web loader does — especially hiring (applicant PII), mentorship (mentee-hidden), payroll numbers, audit logs.
- **Audit logging.** Dispatcher logs `mcp.tool_called` for all; domain-event logging (`logAuditEvent`) stays in the underlying server fns and must be preserved when tools wrap them.
- **Test burden.** Convention is one spec per tool/cluster (34 today). Faceted tools test each action; reuse the existing route server fns so MCP tools are thin adapters, not reimplementations.
- **Rate limits & payload cap.** Existing 120 req/min per grant + 13 MB body cap carry over; revisit if bulk-read tools return large payloads (add pagination on `list_*`).
- **Reuse, don't reimplement.** Wherever a route already has an extractable server fn, the MCP tool calls it. Where logic lives inline in an action, extract a shared server fn first (benefits both surfaces).

---

## 9. Deferred / explicitly out of scope

- Hiring writes (D2). · Payroll operations, Gmail OAuth, member role grants, domain create/delete (§6.9). · SSE streams, webhooks, CSV/PDF exports, drag-reorder endpoints, field-placement canvas UIs. · External partner-portal (`/partner`, PartnerUser auth — not member MCP). · Per-domain scopes (revisit if a dedicated single-purpose client emerges; risk tiers cover it for now).

---

## 9b. As-built (2026-08-05)

Built on branch `feat/mcp-expansion`. Full suite green: typecheck at pre-existing
baseline (no new errors), **3334 unit tests pass**, production build clean.

- **Foundation:** `app/mcp/registry.ts` (registry + dispatcher, additive — legacy
  switch kept for un-migrated tools), `app/mcp/errors.ts` (leaf error module +
  `requireForAction`), `mcp:admin` scope with role-gated consent
  (`oauth.register.ts` + `oauth.consent.tsx`).
- **~92 new tools** across 11 area modules (`app/mcp/tools/<area>/`): hiring (6,
  read-only), education (14), partners (9), docs/comments/notes/search (17),
  calendar/profile (6), mentorship (7), signing (5), forms (6), admin (9),
  projects-extra (7), faceted (6). **42 new test files.** Total served catalog ≈ 142.
- **Deviations from the original plan (both per your calls):**
  1. **No backward compatibility** (was D4 "deprecated aliases"). The 6 faceted
     clusters' 20 granular tools were **removed outright** from the served catalog
     (imports, `TOOLS` array, switch cases, error map) — not aliased. The faceted
     `manage_*` tools route to the existing (unchanged, still-tested) `run*` fns.
  2. **`update_task_status` fold skipped** — `update_task` deliberately excludes
     status (special transition logic); folding wasn't worth the risk for −1 tool.
     `update_task_status` stays a discrete tool.
  3. **Help page (`help.mcp`) is category-based static, not live-autogen.**
     Importing the live tool graph into a client-rendered route pulls server-only
     modules (prisma/collab/notify) into the client bundle (build fails). The page
     now describes the surface by category; the client's own `tools/list` is the
     authoritative live catalog.
- **Hiring is read-only** (D2) — 0 hiring write/admin tools shipped.

## 10. Open questions

1. Deprecation window length for faceted-tool aliases before removal?
2. `restore_collab_version` — confirm it reuses the web's restore path and respects the clone rule.
3. Should `list_audit_logs` really be `mcp:admin` read, or excluded entirely like payroll? (Currently: admin read.)
4. Mobile app: which Wave-1 reads are on its critical path — sequence those first within Wave 1.
