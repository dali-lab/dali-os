# Infrastructure Dashboard — Spec

Status: **BUILT** 2026-09-04 (branch `feat/infra-dashboard`, flag `infra-dashboard` OFF).
Shaped spec-first; this doc is the source of truth for the design.

A Core-only admin area that pulls Fly.io + Neon inventory and usage into one place and
lets admins take interactive infrastructure actions (scale, set limits, provision a DB,
reap idle resources) without leaving the app. Replaces the current workflow of logging
into each provider's console separately.

---

## 1. Goals & non-goals

**Goals**
- One screen showing the lab's Fly + Neon fleet: what's running, how big, and how much it's *using*.
- Interactive, audited actions for scaling, limits, provisioning, and cleanup.
- Safe by construction: prod-critical infra cannot be destroyed from the UI.

**Non-goals / hard constraints**
- **No dollar figures.** Neither Fly nor Neon exposes real spend/invoice/MTD-bill via API
  (Fly billing is "a black box → Stripe"; Neon returns raw usage only, and its account-wide
  consumption endpoint was removed June 2026). We show **usage metrics + trends** and
  **deep-link out** to each provider's billing page for the authoritative dollar number. We do
  **not** maintain a price table or compute estimates.
- Not a request/approval workflow. Core self-service; "asks" happen out-of-band (Slack).
- Not a Fly-Postgres provisioner (see §5). Provisioning a DB = Neon only in v1.

---

## 2. Decisions (locked)

| Question | Decision |
|---|---|
| Cost data | Usage only, no dollars; link out to Fly/Neon billing |
| v1 scope | Full — reads + safe actions + provisioning + destructive, behind guardrails |
| Action model | Core self-service (confirm + audit); no request queue |
| Areas | Neon quotas/limits, Neon provision + autoscaling, Fly scaling & lifecycle, orphan cleanup |
| Access — reads + safe reversible actions | All **Core** |
| Access — destructive / provisioning / quota | **Admin only** |
| Cleanup classification | Review list: surface everything not on the protected allowlist, sorted by idleness + age; Admin reaps per-row |
| Org model | **One Fly org + Neon org per lab project** → cross-project fleet console, UI grouped by project |
| Registry storage | DB-backed, Admin-managed (`InfraProject`); Fly tokens AES-256-GCM encrypted at rest |
| Neon auth | One shared personal key + per-project `org_id` |

---

## 3. Architecture

```
app/lib/infra/
  fly.server.ts     typed fetch over https://api.machines.dev/v1  (REST only; org from env, no GraphQL)
  neon.server.ts    typed fetch over https://console.neon.tech/api/v2  (+ async operations polling)
  guard.server.ts   protected-resource allowlist, Admin gate, audit helper, secret redaction
  types.ts          normalized inventory + usage shapes
app/jobs/
  infra-snapshot.server.ts   hourly sweep of both providers → Postgres; registry entry
app/admin/routes/
  admin.infra.tsx   Core loader (renders cached snapshot); action handlers (Admin-gated writes)
prisma/schema.prisma
  InfraSnapshot, InfraUsageSample
app/lib/feature-flags.ts
  "infra-dashboard" flag (default off)
```

**Read path is cached, not live.** The hourly job sweeps both providers and writes snapshots;
the page renders from Postgres — instant, rate-limit-safe, and gives us trend history. A
"Refresh now" button re-runs the sweep on demand.

**Skip Fly GraphQL.** The only thing REST can't do is list orgs, and its GraphQL API is
officially unsupported. Orgs come from the project registry (§4), so we enumerate apps per
registered org via `GET /v1/apps?org_slug=` — no GraphQL dependency at all. The sweep loops
over every registered project and tags each snapshot/usage row with its project.

---

## 4. Auth & secrets — MULTI-ORG (one Fly + Neon org per lab project)

The lab uses a **separate Fly org and Neon org per project**, so this is a cross-project fleet
console, not a single-org view. Two provider facts shape the model:

- **Fly tokens are org-scoped.** `fly tokens create readonly -o <org>` grants exactly one org;
  no single token spans all orgs (the account-wide personal token is deprecated). → **one
  readonly token + one write token per project/org.**
- **Neon personal key is account-wide.** A personal API key "reaches everything the account can,
  in every org"; you pass `?org_id=` per call. → **one shared Neon personal key + a list of
  `org_id`s** (not one key per project). No read-only org key exists, so the same key reads and
  writes — mitigated by our Admin gate + confirm + audit, key server-only.

So configuration is a **registry of projects**, each:
`{ label, flyOrgSlug, flyReadToken, flyWriteToken, neonOrgId }` + one shared `NEON_API_KEY`.
Because orgs are registered explicitly we never enumerate orgs → **Fly GraphQL stays fully
unused.** Header `Authorization: Bearer <token>` for both.

**Storage of the registry — DECIDED: DB-backed, Admin-managed.** `InfraProject` rows (§6); Admin
adds/edits/removes a project + pastes its Fly tokens in the dashboard, no redeploy to onboard.
Fly tokens are **encrypted at rest** via `app/lib/infra/crypto.server.ts` (AES-256-GCM, key from
`INFRA_SECRET_KEY` env). Only the shared `NEON_API_KEY` (Neon personal key) stays an env secret.
Tokens are decrypted server-side only, never returned to the client (write-only fields in the
registry UI — show "set / not set", never the value).

---

## 5. Provider capability summary (from API research, verified Sept 2026)

**Fly (Machines REST API, `api.machines.dev/v1`)**
- Read: `GET /apps?org_slug=`, `GET /apps/{app}/machines` (guest cpu/ram/region/state),
  `/apps/{app}/volumes`, `/apps/{app}/ip_assignments`, `GET /postgres?org_slug=` (Managed PG).
  Usage metrics via Prometheus `api.fly.io/prometheus/<org>` (~15-day retention: egress, cpu, mem).
- Write: vertical scale `POST /machines/{id}` (`config.guest`), start/stop/restart/suspend,
  create machine/app, create/extend volume, destroy machine/app/volume (`?force=true`).
- **Not via REST:** secrets (CLI/GraphQL, needs redeploy), Managed-Postgres *provisioning*
  (CLI only), horizontal count (= create+destroy orchestration; scale-down destroys machines).
- No pagination on list endpoints; per-action rate limits (~1 rps burst 3); no idempotency key
  → dedup by machine `name`.

**Neon (`console.neon.tech/api/v2`)**
- Read: `GET /projects`, `/projects/{id}/branches`, `/projects/{id}/endpoints` (live min/max CU,
  `suspend_timeout_seconds`, state), `/operations`. Usage via
  `GET /consumption_history/v2/projects` (compute_unit_seconds, storage bytes-month, transfer);
  fan out per-project and sum (account-wide endpoint removed).
- Write: `POST /projects` (provision DB), `PATCH /projects/{id}/endpoints/{ep}` (autoscaling
  min/max CU + scale-to-zero), `POST .../endpoints/{ep}/suspend|restart`,
  `PATCH /projects/{id}` → `settings.quota` (limits), delete project/branch.
- **Quota foot-gun:** hitting a period quota (`active_time_seconds`, `compute_time_seconds`,
  `written_data_bytes`, `data_transfer_bytes`; `logical_size_bytes` is per-branch) **suspends
  the project's compute until the next billing period** — a connection won't wake it, only
  raising/zeroing the quota. `0` = unlimited / clear.
- Async: writes return `operations[]` → poll to terminal before dependent calls; 423-Locked on
  concurrent ops → backoff. 700 req/min account budget.

---

## 6. Data model

```prisma
model InfraSnapshot {          // latest-wins current state + raw audit trail
  id         String   @id @default(cuid())
  projectKey String   // which lab project/org this belongs to
  provider   String   // "fly" | "neon"
  fetchedAt  DateTime @default(now())
  payload    Json     // normalized inventory for that (project, provider) sweep
  @@index([projectKey, provider, fetchedAt])
}

model InfraUsageSample {       // time series for trend sparklines (no dollars)
  id         String   @id @default(cuid())
  projectKey String
  provider   String
  scopeType  String   // "fly-app" | "neon-project" | "neon-endpoint"
  scopeId    String
  scopeName  String
  metric     String   // "compute_unit_seconds" | "egress_bytes" | "storage_bytes" | ...
  value      Float
  at         DateTime
  @@unique([provider, scopeType, scopeId, metric, at])
  @@index([projectKey, metric, at])
}

model InfraProject {              // Admin-managed registry, one row per lab project
  id            String  @id @default(cuid())
  key           String  @unique   // stable projectKey used above
  label         String
  flyOrgSlug    String?
  neonOrgId     String?
  flyReadToken  String?           // AES-256-GCM encrypted at rest (INFRA_SECRET_KEY)
  flyWriteToken String?           // AES-256-GCM encrypted at rest
  enabled       Boolean @default(true)
}
```

`InfraUsageSample` is our long-term usage record (Fly Prometheus only retains ~15 days).

---

## 7. Background job

`infra-snapshot` — registry entry in `app/jobs/registry.ts`, interval ~60 min.
Idempotent sweep: enumerate Fly apps/machines/volumes + Neon projects/branches/endpoints →
write one `InfraSnapshot` per provider (latest-wins render source) + upsert `InfraUsageSample`
rows. Settings knobs: `flyEnabled`, `neonEnabled`, `usageLookbackDays`. Bounded well under the
lease; caches so the page never calls provider APIs on load.

---

## 8. UI / IA

Core-only "Infrastructure" subtab under the **system** admin cluster (`adminNav.tsx`).
**Everything is organized by lab project** (= Fly org + Neon org), since that's how the fleet is
partitioned.

- **Overview** — per-project cards + a fleet roll-up: Fly apps/machines running, Neon
  projects/computes active, aggregate usage this period, last-sweep time + Refresh, and
  per-project "View Fly billing" / "View Neon billing" links.
- **Project drill-in** — for a selected project:
  - **Fly** — apps → machines (size / region / state) with per-row actions; volumes; usage sparkline.
  - **Neon** — the org's Neon projects → endpoints (min/max CU, scale-to-zero, state) + quota
    panel + consumption sparkline; "New project" (Admin).
- **Cleanup** — cross-project review list of every non-protected resource sorted by idleness +
  age; per-row and bulk reap (Admin).
- **Projects registry** (Admin) — add/edit/remove a project + its tokens (if storage option A).

Non-Admin Core see reads + safe controls; destructive/provision/quota controls are hidden/disabled.

---

## 9. Action catalog + guardrails

| Tier | Actions | Access | Guardrail |
|---|---|---|---|
| Safe / reversible | Fly start/stop/restart/suspend machine; Fly vertical scale; Neon suspend/restart endpoint; Neon set autoscaling min/max CU + scale-to-zero | Core | `useDialog().confirm()` + audit |
| Impactful | Neon set project quotas; Fly machine count | Admin | `confirm({tone:"destructive"})` + explicit foot-gun warning (quota-hit suspends till next period; scale-down destroys) + audit |
| Destructive / provision | Neon create/delete project & branch; Fly destroy machine/app/volume; bulk reap | Admin | type-to-confirm (type the resource name) + audit with before/after + op polling |

Every action → `logAuditEvent({action:"infra.*", targetId, metadata})` with new
`AUDIT_ACTIONS` entries (`infra.fly.scale`, `infra.fly.destroy`, `infra.neon.provision`,
`infra.neon.quota`, `infra.reap`, …).

---

## 10. Safety design

1. **Protected-resource allowlist** (`guard.server.ts`) — protects **the DALI OS platform's own
   infra**: `dali-api-prod`, `dali-api-staging`, and their Neon project are **structurally
   non-destroyable and non-quota-able**, enforced server-side before any write, regardless of who
   clicks. The dashboard runs *on* this infra; this is the primary rail. Derive the self app from
   `FLY_APP_NAME`. Per-client-project infra is *not* on the allowlist — decommissioning a finished
   project (destroy its Fly app + Neon project) is a legitimate Admin action, still behind
   type-to-confirm + audit.
2. **Admin gate** on all impactful/destructive/provision handlers (`isAdmin`), independent of
   the UI hiding controls.
3. **Secret redaction** — Neon `connection_uris` and role-reset passwords are never logged,
   audited, or returned to the client in cleartext.
4. **Async correctness** — poll Neon `operations[]` to terminal; surface in-progress state; back
   off on 423.

---

## 11. Cleanup / orphan review

No coupling to any CI workflow. The Cleanup tab surfaces **every resource not on the protected
allowlist**, annotated with last-active + age, sorted by idleness. Signals: Neon
branch/endpoint compute inactivity + `last_active`; Fly app stopped / no recent machine activity.
Admin reviews per-row and reaps (type-to-confirm) or bulk-reaps. Purely a visibility + one-click
tool — no automatic deletion, ever.

---

## 12. Build order

1. Prisma models + migration (`InfraProject`, `InfraSnapshot`, `InfraUsageSample`);
   `crypto.server.ts` (AES-256-GCM) + `INFRA_SECRET_KEY`.
2. Registry admin surface — add/edit/remove projects + paste tokens (write-only fields). Nothing
   downstream works until at least one project is registered.
3. Adapters (`fly.server.ts`, `neon.server.ts`) + `guard.server.ts` + types — read-only first.
4. `infra-snapshot` job (loops registered projects) + Refresh-now.
5. `admin.infra.tsx` read-only render (per-project Overview + Fly + Neon inventory + sparklines)
   behind the `infra-dashboard` flag.
6. Safe/reversible actions (Core) + audit + confirm.
7. Impactful + destructive + provisioning (Admin) + type-to-confirm + protected allowlist.
8. Cleanup review list + reap.
9. (Optional, later) mirror read + safe actions as `mcp:admin` tools.

---

## 13. Open risks

- One shared Neon **personal** key spans every org and does read + write (no read-only scope) —
  broad blast radius, mitigated by Admin gate + audit + server-only handling. (Alternative: an org
  key per project, more tokens to manage.)
- Fly needs one readonly + one write token **per project/org** — N tokens to mint and store.
- Fly usage history is ~15 days (Prometheus) — our `InfraUsageSample` becomes the record; early
  trends are thin.
- Managed-Postgres provisioning + Fly secrets are CLI-only → out of scope; Fly stays read + scale/
  lifecycle, provisioning is Neon-only.
- Provider price/plan drift is irrelevant to us (we show no dollars) — a deliberate benefit of the
  usage-only decision.

## 14. Resolved decisions

- **Registry storage:** DB-backed, Admin-managed (`InfraProject`), Fly tokens AES-256-GCM
  encrypted at rest via `INFRA_SECRET_KEY`. Registry admin surface lives in the Infrastructure tab.
- **Neon auth:** one shared **personal** API key (`NEON_API_KEY`) spanning all orgs, `org_id` per
  call from the registry. (Not one org key per project.)
