# External (non-DALI) instructors for Education

**Status:** BUILT 2026-08-25 (uncommitted) — typecheck 0 app/ errors, 3708 unit tests pass, build green · **Branch:** `feat/education-external-instructors` · **Author:** discussion with Kiran, 2026-08-21

## Problem

The Education/LMS section was built on the assumption that an instructor is a strict
subset of DALI members. The reality: an instructor can be a **Dartmouth student who is
not a DALI member** — they have a Dartmouth email and can log in via Dartmouth SSO (CAS),
and they need the same LMS *management* access as a DALI-hired instructor for their
offering. Instructor is orthogonal to membership; it can overlap DALI members and plain
Dartmouth students.

## The reassuring part: the data model is already right

Instructor is already an offering-scoped role on **any** `User`, decoupled from membership:

- `InstructorAssignment` = `(userId, offeringId, termId)` on any `User`, no membership FK
  (`prisma/schema.prisma:2429`).
- `isOfferingManager(userId, offeringId)` = `isCore` **OR** holds an `InstructorAssignment`
  for that offering — never checks membership (`education/lib/access.server.ts:12`).
- `isInstructor` / `getUserRoles.isInstructor` derive purely from an `InstructorAssignment`
  row (`lib/roles.ts:438`).
- A Dartmouth student can already authenticate: CAS creates a `User` keyed on `netId`,
  no `daliEmail`, no `DALIMember` row (`user-provisioning.ts:101`).

So a non-DALI instructor is already a coherent object. **No schema migration is needed.**
The "instructor ⊆ member" assumption lives only in three thin surfaces above the data
layer, listed below.

## Identity model (the load-bearing insight)

- **Membership = the `DALIMember` row**, not the email. `promoteToMember` confers
  membership by creating a `DALIMember` row on the person's existing account; it never
  issues a `daliEmail` (`members/lib/membership.server.ts:26`).
- **External instructors instruct on their Dartmouth NetID/CAS login and do NOT receive a
  dali email for instructing.** They stay non-member `"dartmouth"`-type accounts that
  happen to hold an `InstructorAssignment`.
- **Everything hangs off one NetID account.** Roles accrete onto it:
  - Applicant only → `/portal`, applies for the lab.
  - Applicant + external instructor → `/portal` + a Teaching door into `/education/manage/*`.
  - Later accepted → `promoteToMember` adds a `DALIMember` row to the *same* account; the
    `InstructorAssignment` is already there. No email, no `linkCasToGoogleUser` merge, no
    second identity. Auth type flips to member and they graduate into the full shell.
- **How they apply to the lab:** the normal way, via `/portal` (the non-member home) on the
  same NetID account. Instructing never touches the apply path.

## Decisions locked (from discussion)

1. **Shell = Option A.** Reuse the existing `/education/manage/*` management routes, contained
   by a single root-layout allowlist guard. No UI duplication.
2. **Home stays `/portal`.** Instructor access is an *additive door*, not a replacement shell.
   The guard's redirect target for a non-member off the allowlist is **`/portal`**.
3. **Provisioning = NetID invite.** Core enters a NetID (+ name); verify via the Dartmouth
   People API; **upsert the `User` by `netId`**; create the `InstructorAssignment`; email an
   invite to `<netId>@dartmouth.edu`. CAS matches on first login.
4. **Powers = operational parity** on their own offerings (attendance, grading, notes,
   announcements, certificates). **Creating offerings and assigning other instructors stay
   Core-only.**
5. **Membership signal in new code = the `DALIMember` row** (`isLabMember`). The new guard
   keys on the row (forward-compatible with NetID-native members). We do **not** rip up the
   existing auth-type gates elsewhere — see Out of scope.

## The three surfaces that encode the old assumption (what changes)

### Gap 1 — the shell bounces them out
`education.manage.*` loaders call `redirectDartmouthToPortal(auth)`, bouncing *every*
`"dartmouth"` user to `/portal/education` (`access.server.ts:68`, used in
`education.manage.tsx:23`, `education.manage.$offeringId.tsx`). And the member shell has no
management-only mode — plus its general areas (Projects, Members, Drive, Calendar) render
for any authenticated user with no membership check (leak audit below).

### Gap 2 — the picker only shows members
The instructor picker queries `currentTermMemberWhere()`, which hard-requires
`daliMember: { isNot: null }` (`education.manage.$offeringId.tsx:127` → `roles.ts:611`).
Non-members are not candidates. (The `set-instructors` action itself accepts any `userId`;
the gate is the picker — `offerings.server.ts:765`.)

### Gap 3 — no way to get them into the system pre-login
To assign someone you need a `User` row; today the only way a Dartmouth student gets one is
by logging in themselves. No invite/shell-user path exists. (The external-mentor precedent,
`api.staffing.external-mentor.ts`, only picks *existing members*, so it doesn't help.)

## Member-shell leak audit (why the guard is required)

With `isLabMember=false, isCore=false, isInstructor=true`, these render today with no
membership check — they would leak to an external instructor unless guarded:

| Area | Gate today | Verdict |
|---|---|---|
| Projects hub `/projects` | auth only | **leaks** |
| Members directory `/members` | auth only | **leaks** |
| Members ▸ Groups | `canViewForms` (= Core **or instructor**) | **leaks** (instructor passes) |
| Drive hub `/drive` | auth only | **leaks** |
| Calendar `/calendar` | auth only | **leaks** |
| Education / Hiring / Partners / Mentorship / Admin / Staffing | each gates explicitly | safe |

The fix is **one central chokepoint**, not five patches, and it future-proofs new areas.

## Architecture

```
Dartmouth student (NetID/CAS, no DALIMember row)
        │
   default home ──────────────► /portal  (apply to lab, student catalog) — unchanged
        │
   Teaching card (shown when isInstructor) ─► /education/manage[/…]  (management routes,
        │                                       lightweight chrome — no member sidebar)
   root-layout guard: !isLabMember ⇒ allow only /education/manage/* (+ exempt);
                       everything else ⇒ redirect /portal
```

**Chrome (decided 2026-08-25):** two surfaces. Home = `/portal` (existing sidebar-less card
dashboard) with a new **Teaching** card. Management = the *same* screens DALI instructors use,
wrapped in a **lightweight portal-flavored chrome** (header "DALI Teaching · <offering>" +
back-to-Portal link, no left nav) — NOT the member sidebar. Core-only controls (instructor
picker, create-offering) stay hidden since they gate on `isCore`.

## Implementation plan

### Phase 1 — Access: the central guard + let managers into management

- **`app/routes/layout.tsx` loader** — add the guard after `roles` is computed. Pseudocode:
  ```ts
  // Non-members (no DALIMember row) may only reach education management inside the
  // member shell; their home is /portal. Members/Core are unaffected.
  if (!isLabMember) {
    const path = new URL(request.url).pathname
    const allowed =
      path.startsWith('/education/manage') ||
      path === '/logout' || path.startsWith('/logout') ||
      path === '/sign' || path.startsWith('/sign/')   // keep signing reachable if ever gated
    if (!allowed) return redirect('/portal')
  }
  ```
  This is a security chokepoint — it gets careful review and its own tests. Keying on
  `isLabMember` (the row) means a future NetID-native member is not misfiled.

- **`app/education/lib/access.server.ts`** — the management routes must stop blanket-bouncing
  Dartmouth users. Replace `redirectDartmouthToPortal` usage in the *manage* loaders with the
  existing manager gates:
  - `education.manage.tsx`: drop `redirectDartmouthToPortal`; keep
    `if (!roles.isCore && !roles.isInstructor) return redirect('/portal')` (change the target
    from `/education` to `/portal` so a non-manager Dartmouth user isn't ping-ponged).
  - `education.manage.$offeringId.tsx` and `education.manage.assignments.$assignmentId.tsx`:
    drop `redirectDartmouthToPortal`; they already call `requireOfferingManager`, which is the
    correct gate.
  - `education.manage.new.tsx`: **Core-only** — keep it closed to instructors (create-offering
    stays Core). Guard with `requireEducationCore` or an `isCore` check.
  - `education.tsx` (`/education` student catalog in the member shell): **leave**
    `redirectDartmouthToPortal` as-is — external instructors don't need the member catalog;
    their door is the Teaching card → `/education/manage`.

- **Lightweight instructor chrome (not the member sidebar).** For a non-member, `layout.tsx`
  renders a minimal layout variant instead of the full member shell — **no left nav**, just a
  simple header ("DALI Teaching · <offering name>") with a **back-to-Portal** link, wrapping the
  same management route content. Implemented as a new branch in `layout.tsx` alongside the
  existing tabless/focus/classic variants (`if (!isLabMember) → <InstructorChrome>`), so no
  routes move and the management components are reused verbatim.
  - Rationale: the full member shell drags in chrome that's broken/nonsensical for a non-member
    (a lone one-item "Education" sidebar, plus favorites/recents/⌘K/liveness that assume
    membership). The lightweight chrome keeps them visually consistent with `/portal`, which is
    their home. (Decided 2026-08-25.)

### Phase 2 — Provisioning: NetID invite + widened picker

> **As built (differs from the plan below):** instead of *widening the picker* to include external
> instructors (which races with the picker's destructive `set-instructors` save), the two are
> **decoupled**: the members-only picker stays as-is but its `deleteMany` is scoped to member
> instructors (`user: { daliMember: { isNot: null } }`), and external instructors are managed by a
> **separate "External instructors" section** (list + remove + NetID/first/last invite form) posting
> the `invite-external-instructor` / `remove-external-instructor` intents. No picker widening, no race.

- **Invite action** — add intent `invite-external-instructor` to the education offering action
  (`offerings.server.ts`, alongside `set-instructors`). Core-only. Steps:
  1. Parse `netId` (+ `firstName`, `lastName`) from the form.
  2. `const person = await peopleByNetId(netId)` (`lib/dartmouth-people.ts:107`). Reject if
     `null` (not a real Dartmouth account). Optionally require `person.isStudent && !person.isAlum`
     (currently enrolled) — confirm with Core whether to allow staff/faculty too.
  3. `const user = await prisma.user.upsert({ where: { netId }, update: {}, create: { netId,
     firstName, lastName, dartmouthEmail: `${netId}@dartmouth.edu` } })` — **upsert by netId**
     so it converges with an existing applicant row; never creates a duplicate.
  4. `prisma.instructorAssignment.create({ userId: user.id, offeringId, termId })`
     (skipDuplicates / upsert on the unique `(userId, offeringId, termId)`).
  5. Send the invite email (Phase 3).
  6. `logAuditEvent({ action: 'education.instructors.invite', ... })` and reuse
     `notifyAdminsOfPromotion` (instructor = pay-affecting promotion, same as `set-instructors`).

- **Widen the picker** (`education.manage.$offeringId.tsx` loader, ~line 125) — candidate list
  = current-term members **∪ this offering's current instructors**, so already-invited external
  instructors appear and survive `set-instructors`' destructive `deleteMany`+recreate. Tag each
  candidate `isExternal = daliMember == null` for an "External" badge in `InstructorPicker`.
  ```ts
  const currentInstructorIds = offering.instructors.map(i => i.userId)
  core ? prisma.user.findMany({
    where: { OR: [ await currentTermMemberWhere(), { id: { in: currentInstructorIds } } ] },
    select: { id: true, firstName: true, lastName: true, daliMember: { select: { id: true } } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  }) : []
  ```

- **Invite UI** — in the Core-only instructors section (~line 660) add an "Invite external
  instructor" affordance: a small form (NetID + first/last name) posting
  `intent=invite-external-instructor`. Use `SelectMenu`/native-cleanup form controls per house
  style. Show current external instructors with a removable "External" chip.

- **`set-instructors` reconciliation** — because candidates now include current instructors,
  external instructors submit as checked `userIds` and survive the replace-all. Removal works by
  unchecking (or a dedicated remove control). No change to the transaction needed beyond the
  widened candidate set — verify with a test.

### Phase 3 — The Teaching card + invite email

- **Teaching card** (`app/routes/portal.tsx`) — add `isInstructor` (or a light
  `manageableOfferingIds` count) to the loader, and render a `CardShell` titled "Teaching" when
  they hold ≥1 `InstructorAssignment`, linking to `/education/manage` (or directly to the single
  offering's manage page when there's exactly one). Matches the existing card pattern
  (`portal.tsx:99`).

- **Invite email** — `sendEmail` (`lib/gmail.ts:177`), to `<netId>@dartmouth.edu`: "You've been
  added as an instructor for <offering> in DALI OS. Log in with Dartmouth SSO at <url>." This is
  transactional (outside the notification-preference layer), consistent with other portal/
  applicant email. `sendEmail` self-gates dev/staging.

## Schema

**None.** `InstructorAssignment` on a NetID-keyed `User` already models everything. The pre-created
shell user *is* the record; CAS matches by `netId` on first login and backfills the name.
(Deliberately not adding an `invitedAt`/invite table for v1 — the audit log covers provenance.)

## Edge cases & lifecycle

- **Applied first, invited later (or vice-versa):** upsert-by-netId converges to one account.
- **Invited, never logs in:** the `User` + `InstructorAssignment` exist but are inert until first
  CAS login; harmless. Consider a follow-up "pending" indicator in the roster (deferred).
- **External instructor gets hired:** `promoteToMember` adds a `DALIMember` row to the same
  account; instructor role carries over; auth type flips to member; they leave `/portal` for the
  full shell. No migration of the `InstructorAssignment`.
- **Name accuracy:** People API doesn't return a name, so Core types it at invite; CAS overwrites
  `firstName`/`lastName` from the authoritative claim on first login (`upsertUserFromCas`).
- **NetID ≠ email local part in reality:** the codebase already assumes
  `dartmouthEmail = <netId>@dartmouth.edu`; we inherit that. NetID (the CAS key) is the reliable
  identifier, which is why provisioning keys on it.

## Testing

- **Unit / access:** the layout guard — non-member off-allowlist → `/portal`; non-member on
  `/education/manage/*` → allowed; member/Core unaffected. `isOfferingManager` for a non-member
  with an `InstructorAssignment` → true.
- **Unit / invite action:** upsert-by-netId converges (existing row reused, no duplicate);
  rejects unknown NetID (`peopleByNetId` null); creates `InstructorAssignment`; audit + admin
  notify fire.
- **Unit / picker:** candidate union includes current external instructors; `set-instructors`
  round-trip preserves an external instructor that stays checked and removes one unchecked.
- **E2E (needs seeded Postgres):** invite → (simulated) CAS login as that NetID → land in
  `/portal` → Teaching card → `/education/manage/:id` → take attendance / grade. Confirm the same
  session cannot reach `/projects`, `/members`, `/drive`, `/calendar` (guard bounces to `/portal`).

## Out of scope / deferred

- **Broad auth-type → row-based migration.** Existing gates (`portal.tsx`,
  `redirectDartmouthToPortal`) still use `auth.user.type` as a membership proxy, which would
  misfile a hypothetical NetID-native member. Left as a known pre-existing gap; the new guard is
  row-based so it's not extended.
- **Manager preview of the student hub** for external instructors (member-shell
  `requireEnrollment` bounces `"dartmouth"` to the portal hub). Deferred; not needed for
  management.
- **Non-Dartmouth external instructors** (no CAS): out of scope — the population is Dartmouth-SSO
  people.
- **Name-search directory picker for invites:** impossible server-side (People API is
  lookup-by-NetID only; `lookup.dartmouth.edu` is behind SSO). Invite is NetID-entry by design.
- **"Pending invite" roster state / resend-invite.** Nice-to-have follow-up.

## Open questions for Core

1. Restrict invitees to currently-enrolled students (`isStudent && !isAlum`), or also allow
   Dartmouth staff/faculty/grad affiliations?
2. Should an external instructor's removal from *all* offerings also tidy anything (it just drops
   their `InstructorAssignment` rows; the account remains as a portal user)? Assume yes, nothing
   else to clean up.
