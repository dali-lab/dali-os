# Signing service: configurability + scheduled issuance — spec

_Drafted July 31, 2026. Follow-up to the document-signing feature (PR #1087, expand) + #1089 (contract/table drop). Turns the current **hardcoded, scattered** cadence/audience logic into config + a small resolver registry, and moves re-issuance into the existing jobs scheduler. Also lands the one deferred item from the original build (`signing-term-issuance`). Not yet built — its own PR._

## Context — the problem

Today, changing *how often* an agreement is signed or *who* must sign it is a **code-level, multi-file change**:

- **Cadence/scope is derived by branching**, not configured. `app/signing/lib/scope.server.ts:resolveAdminScope` computes the binding scope from `kind`/`audience` (`isTermly = kind === "MentorshipAgreement" || audience === "Mentors"` → `term:<id>`, else `app`). There is **no** cadence/interval/expiry field on the models (confirmed).
- **Audience is re-implemented in ~6 places.** The same "who is in this audience" concept is hardcoded across:
  - `state.server.ts` → `audienceIncludes`, `activeMemberAudienceWhere`, `listTermMentors`
  - `state.server.ts:listOutstandingBindings` (the app gate)
  - `notify.server.ts:notifySignRequest` (hardcoded to `ActiveMembers`)
  - `sign.$bindingId.tsx` (inline `ActiveMembers`/`Mentors` audience check)
  - `admin-console.agreements.$id.tsx` loader (roster branches `ActiveMembers` vs `Mentors`)
- **Termly re-issuance is manual.** A mentorship agreement only re-issues when an admin clicks "Put in force" for the new term; nothing schedules it.

Goal: creating/tuning an agreement (cadence, audience, enforcement) becomes **admin config, not a deploy**, and re-issuance + reminders run automatically in the jobs scheduler.

## Non-goals

- No fully generic, admin-defined audience/rule builder. Audiences stay a bounded enum resolved by code — a query over the org model can't be pure data. The registry just makes adding one a **one-file** change.
- No signature "expiry on a clock." Re-signing stays version-in-force + period-scoped (an issued binding per period), not a per-signature TTL.

## Proposed changes (three parts; independently shippable)

### Part 1 — cadence as data (retire the `resolveAdminScope` branch)
- Add `cadence SigningCadence @default(Once)` to `SigningDocument` (`Once` | `PerTerm` | `PerCycle`). Migration + admin form field on `admin-console.agreements.tsx`.
- `resolveAdminScope` reads `doc.cadence` instead of inferring from `kind`/`audience`:
  - `Once` → `scopeKey: "app"` (one standing binding; re-sign only on a new version in force)
  - `PerTerm` → `scopeKey: "term:<currentTerm>"`
  - `PerCycle` → cycle-scoped (bound from hiring UI, unchanged)
- Back-compat: default existing `MentorshipAgreement`/`Mentors` docs to `PerTerm`, `Confidentiality` to `PerCycle`, else `Once`, in the migration.

### Part 2 — audience resolver registry (consolidate the ~6 sites)
- New `app/signing/lib/audiences.ts`: `AUDIENCE_RESOLVERS: Record<SigningAudience, AudienceResolver>` where
  ```ts
  type AudienceResolver = {
    includes: (userId: string, cohorts: SignerCohorts) => boolean;
    listMembers: (ctx: { termId?: string }) => Promise<Person[]>; // for roster + notify + issuance
    prismaWhere?: unknown; // optional, for bulk member queries
  };
  ```
  Entries: `ActiveMembers` (active non-staff members), `Mentors` (`listTermMentors`), plus room for `DomainLeads`/`Instructors`/`HiringParticipants` later — each ONE entry.
- Refactor the 6 call sites to consume the registry: `audienceIncludes` → `AUDIENCE_RESOLVERS[a].includes`; the admin roster + `notifySignRequest` + issuance use `listMembers`. Delete the scattered `activeMemberAudienceWhere`/inline switches (move into the registry).
- Adding an audience type = one registry entry; zero changes to gate/roster/notify/fill.

### Part 3 — `signing-issuance` job (the jobs scheduler home)
- New handler `app/jobs/signing-issuance.server.ts` + one entry in `app/jobs/registry.ts`, modeled on `membership-status-sync` (the existing term-rollover job). `JobDefinition` = `{ name, intervalMinutes, settings, handler }`; interval + settings operator-editable in **Admin → Jobs**.
- Each tick, idempotently:
  1. **Materialize current-period bindings.** For each active document with a recurring cadence (`PerTerm`), ensure a binding exists for the current period via upsert on `@@unique([documentId, scopeKey])` (re-runs are no-ops). This replaces the manual per-term "Put in force".
  2. **Reminder nudges.** For each in-force binding, `listOutstandingBindings`-style, `notify("document.sign_request")` signers who are past a `reminderLeadDays` setting and still unsigned (dedupe via a per-period marker).
- Settings (declared, admin-editable): `reminderLeadDays`, maybe `enabled` per cadence. Handler stays idempotent + bounded per tick (CLAUDE.md job rules).

## How the three compose

**cadence = data** (on the document) · **audience = resolver registry** (localized code) · **execution = jobs scheduler** (idempotent, admin-tunable). Result: new agreements + cadence/audience tuning are config; a genuinely new cadence or cohort *type* is one localized addition, not a 6-file sweep.

## Files

- `prisma/schema.prisma` — `SigningCadence` enum + `SigningDocument.cadence`; migration (+ back-compat backfill)
- `app/signing/lib/scope.server.ts` — read `cadence` instead of branching
- `app/signing/lib/audiences.ts` — NEW resolver registry
- `app/signing/lib/state.server.ts`, `notify.server.ts`, `routes/sign.$bindingId.tsx`, `routes/admin-console.agreements.$id.tsx` — consume the registry (delete scattered branches)
- `app/jobs/registry.ts` + `app/jobs/signing-issuance.server.ts` — NEW job (model on `membership-status-sync`)
- `app/signing/routes/admin-console.agreements.tsx` — cadence field in the create form
- Reuse: `currentTerm()` (`lib/roles.ts`), `notify()` (`lib/notify.server.ts`), the `@@unique([documentId, scopeKey])` idempotency

## Rollout / risk

- Ship in the three parts above; each is independently valuable and low-risk. Part 1 + 2 are pure refactors behind the same behavior; Part 3 adds automation (guard with the job's `enabled` toggle so it can ship dark).
- Keep `kind`/`audience` enums; `cadence` is additive. No signature-data migration.
- The issuance job must be idempotent (lease may re-run) and bounded — mirror `membership-status-sync`.

## Verification

- `npm run typecheck`, `npm test`, `npm run build`.
- Unit: registry resolvers (includes + listMembers) per audience; `resolveAdminScope` per cadence; issuance handler idempotency (second run = no-ops).
- Manual (seeded DB, `POST /internal/jobs/tick` or Admin → Jobs "Run now"): a `PerTerm` mentorship doc auto-gets the current term's binding; outstanding mentors get a `document.sign_request` nudge after `reminderLeadDays`; re-tick creates nothing new.
- Confirm the gate/roster/fill/notify all still behave after the registry refactor (existing signing e2e + the hiring confidentiality path).

## Open questions

1. Cadence granularity — is `Once | PerTerm | PerCycle` enough, or do we want `Annual` / `OnDate` too? (Add as more enum values + a resolver; the job loop is the same.)
2. Should `gateScope` fold into `cadence` (they're correlated: `PerCycle` ⇒ `HiringCycle`), or stay orthogonal for flexibility?
3. Reminder policy — single nudge per period, or escalating (e.g. lead-days then overdue)? Affects the dedupe marker.
