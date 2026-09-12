# Activities — a time-boxed "mode" layer

**Status:** BUILT on `feat/activities` (v1: scavenger-hunt mechanic). Review pass 2026-09-10 moved
the surface from a dedicated `/activities/:id` page to a **shell modal** over the current page
(fed by the `/api/activities/:id` resource endpoint) and the entry point from a floating pill to a
`DesktopBanner`-style **top-bar bar**. Review pass 2026-09-11: authored code **routes normalized**
(the exact-match bug — §8); admin editor uses the real **breadcrumb trail** instead of a hand-rolled
path; the leaderboard is now **live via SSE** (§7.6); and codes take an optional **hint** with an
operator-chosen reveal policy (free / points / delay — §8). Deferred: the lifecycle job +
notifications (§7.9) and MCP tools (§7.10).
**Author:** planning session, 2026-09
**Rollout flag:** `activities` (default off)

## 1. What this is

A generic **Activity** layer: a time-boxed, term-scoped, audience-targeted experience that
can change what the site shows for the people it's assigned to, and optionally collect
per-user participation and show results. When the window closes, the site reverts on its own.

The first (and today only) concrete use is an **onboarding scavenger hunt**: new members get a
Drive doc of clues, hunt for codes hidden across the site, submit them in a modal that floats over
whatever page they're exploring, and watch a leaderboard. Future uses named during planning — seasonal **themes**, **event** banners,
onboarding **bingo**, demo-day **voting** — plug in as new *mechanics* with **no schema change**.

This is deliberately its own layer, **not** an extension of feature flags. See §3.

## 2. Vocabulary

- **Activity** — one instance (this term's hunt, this year's Halloween theme). A DB row.
- **Mechanic** — the pluggable behavior an activity runs (`scavenger_hunt`, `theme`, `event`, …),
  selected by `Activity.kind`. Defined in code; adding one needs no migration.
- **Spine** — everything every activity shares: window, term, audience, status, the
  "active-for-me" gate, the shell bar, the surface. Generic; lives in the 3 tables below.
- **Overlay** — the mechanic's scattered on-page elements (the hunt's hidden codes).
- **Surface** — the mechanic's own UI (submit + progress + results), rendered in a **modal**
  over whatever page the member is on (the activity's point is to explore the site, so a
  dedicated page would force constant back-and-forth). Data comes from the `/api/activities/:id`
  resource endpoint (loader + submit action); there is no navigable surface page.

## 3. Why its own layer, not a feature flag

A `FeatureFlag` is a **stateless gate**: `enabled` + targeting (`everyone`/`roles`/`userIds`) →
a boolean, resolved by `evaluateFlag()`. It has no time window and holds no per-user state, and
its `key` is a **static constant** referenced by code (`useFeatureFlag("key")`) — a new flag is a
code change by design. An activity is the opposite: a **runtime instance** created per term by an
operator, with an active window and **per-user outcomes** (who found which code, the leaderboard).

Per-user outcomes are the bright line — targeting is an *input* ("are you in?"); a `code_found`
row is an *output*. A flag models inputs. So activities are their own tables; a flag plays exactly
**one** role here — the subsystem rollout gate (`activities`, default off), per the CLAUDE.md
"gate new features behind a flag" rule.

The lightweight future (themes/events whose behavior is *code*, no per-user state) is better served
by a *separate, small* change — adding an optional schedule to `FeatureFlag` — than by forcing them
through this layer. That's out of scope here; noted so we don't conflate the two.

## 4. Data model

Three new tables. `FeatureFlag` is untouched. `kind` is a **plain `String` validated against the
mechanic registry (§5), not a Prisma enum** — so a new mechanic never touches the schema. `userId`
is a plain indexed string (mirrors `FeatureFlag.userIds` — no hard FK, so a departed user just stops
matching), not a relation, to avoid cascade coupling.

```prisma
model Activity {
  id               String         @id @default(cuid())
  kind             String         // registry-validated: "scavenger_hunt" | "theme" | ...
  termId           String?        // scope + per-term reuse; Term.id
  term             Term?          @relation(fields: [termId], references: [id])
  name             String
  status           ActivityStatus @default(Draft)  // Active/Ended are DERIVED from the window (§6)
  startsAt         DateTime
  endsAt           DateTime
  // Audience (mirrors flag targeting; union of the four)
  audienceEveryone Boolean        @default(false)
  audienceRoles    String[]       // subset of ROLE_TARGETS
  assignedGroupId  String?        // reuses the Group system
  assignedGroup    Group?         @relation(fields: [assignedGroupId], references: [id])
  // Mechanic content, validated by a per-kind zod schema. A doc URL/id lives here
  // if a mechanic wants one — NO first-class document FK (docs are informal, optional).
  config           Json
  createdById      String
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  participants     ActivityParticipant[]
  events           ActivityEvent[]

  @@index([status, startsAt, endsAt])
  @@index([termId, kind])
}

model ActivityParticipant {       // explicit adds, unioned with group/role/everyone
  activityId String
  activity   Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  userId     String
  @@id([activityId, userId])
  @@index([userId])
}

model ActivityEvent {             // the ONE generic per-user participation primitive
  id         String   @id @default(cuid())
  activityId String
  activity   Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  userId     String
  type       String   // mechanic-defined: "code_found" | "vote_cast" | "square_checked" | "rsvp"
  refId      String   @default("")  // codeId / optionId / ""; NOT null — see gotcha in §12
  points     Int      @default(0)
  createdAt  DateTime @default(now())
  @@unique([activityId, userId, type, refId])   // dedup
  @@index([activityId, userId])
  @@index([activityId, type])
}

enum ActivityStatus { Draft Published Archived }
```

Progress and leaderboards are **derived** from `ActivityEvent` — no progress/leaderboard tables.
Mechanic *content* (the hunt's code list, a theme's palette) lives in `config` JSON; if a future
mechanic's content grows relational, it may add its own typed table keyed by `activityId` without
disturbing the spine.

## 5. The mechanic contract

The repo splits client-safe from server code (`feature-flags.ts` vs `.server.ts`) because a stray
server import into a client module crashes the client bundle. So the contract is **two mirrored
registries**, keyed by `kind`.

**Client-safe** — `app/lib/activities.ts`
- The `kind` list + per-kind `config` TypeScript types.
- `isActivityActive(activity, now): boolean` — pure; mirrors `isRegistrationOpen`
  (`status === "Published" && startsAt <= now && now <= endsAt`).
- `matchesAudience(activity, userId, roles, groupIds): boolean` — pure; mirrors `evaluateFlag`
  (`everyone || roles∩audienceRoles || assignedGroupId∈groupIds || explicit participant`).

**Client mechanic registry** — `app/activities/mechanics/registry.ts` — `kind → React pieces`:
- `Overlay(overlay)` — the scattered on-page elements for the current route.
- `Surface({ active, progress, results, submitAction, onChanged, … })` — the submit + progress +
  results UI the shell renders **in the activity modal**. Its forms post to `submitAction`
  (`/api/activities/:id`); after a successful mutation it calls `onChanged()` so the modal reloads.
- `AdminEditor(config, onChange)` — authoring UI for `config`.
- `bannerCta` — the shell bar's button label for this mechanic.

**Server mechanic registry** — `app/activities/mechanics/registry.server.ts` — `kind → handlers`:
- `parseConfig(input)` (zod) — validates + normalizes `config` on author.
- `overlayPayload(activity, pathname)` — route-filtered, safe-to-send on-page payload.
- `onAction(activity, userId, input)` — handle an action, write `ActivityEvent`(s), return a result.
- `summarize({ activity, userEvents, allEvents, viewerIsCore })` — `{ progress, results }`.
- `bannerSummary?(activity, userEvents)` — optional short shell-bar label (e.g. `"3/8 found"`);
  return `null` for mechanics with nothing to count (e.g. a theme).

Adding a mechanic = one client module + one server module + a `kind` value. Nothing in the spine
or schema changes.

## 6. Lifecycle & status

`status` is persisted as `Draft | Published | Archived`. **"Live right now" is computed**, not
stored: `isActivityActive()` = `Published && now ∈ [startsAt, endsAt]`. "Ended" = `Published &&
now > endsAt`. This is the Education-Offering pattern (`isRegistrationOpen`) — gating needs **no
job**, and when `endsAt` passes the shell simply stops surfacing the activity (§7.5), so the site
reverts with no teardown.

A small **job** is needed *only* if we want notifications at the boundaries (see §7.9). Modeled on
`form-windows` (which publishes/unpublishes on a schedule) — it would fire `activity.opened` /
`activity.completed`, not flip any gate. Ships `enabledByDefault: false`.

## 7. Integration points

Line refs are against the tree at spec time; treat as anchors.

1. **Migration.** Add the 3 tables + `ActivityStatus`. New tables only → `migration-check` stays
   green. Needs `DIRECT_URL` (see `prisma/MIGRATIONS.md`).

2. **Rollout flag.** Add one entry to `FEATURE_FLAGS` in `app/lib/feature-flags.ts`
   (`key: "activities"`, no defaults → off). Gate every surface below on
   `isFeatureEnabled("activities", …)` (server) / `useFeatureFlag("activities")` (client).

3. **Shell loader** — `app/routes/layout.tsx`. Add `resolveActiveActivitiesForUser(userId, roles,
   now)` to the `Promise.all` at ll.140-170 (the block that already runs `resolveFeatureFlags`,
   l.169). It returns the activities live *for this user right now* (audience ∧ active window),
   each with the minimal payload the banner/overlay need (id, kind, name, mechanic overlay data).
   Resolving audience needs the user's group ids — compute once via the existing
   `listVisibleGroupsForUser`/`computeGroupIdsForUser` helper and pass to `matchesAudience`.
   Thread the result into the loader's return object (l.218) next to `flags`.

4. **Provider + hook.** `ActivitiesProvider` (mirror `FeatureFlagsProvider` in
   `app/components/FeatureFlags.tsx`), carrying the active-for-me list. `useActiveActivities()` and
   `useActivity(kind)` let any component read hunt state + overlay data.

5. **Global chrome — mind the iframe.** In tab mode the routed page renders **inside a
   `TabWorkspace` iframe**: the *embedded* branch returns early with `pageContent`, while the
   sidebar shell (`LayoutOS`) + `LaunchWelcome`/`TimeZonePrompt` render in the main branch.
   Therefore:
   - **`<ActivityLauncher>`** (the shell bar + surface modal) → mount in **`LayoutOS`**, right after
     `<DesktopBanner/>`. That's the idiomatic shell-banner slot (matches `DesktopBanner`'s
     full-width bar, not a floating pill), it renders once around the tabs, and the modal it owns
     (`fixed inset-0`) cleanly covers the iframe. The embedded branch never renders `LayoutOS`, so
     the bar/modal correctly stay out of the iframe. The bar opens the modal (one live activity →
     straight to its surface; several → a small picker).
   - **`<ActivityOverlay>`** (scattered per-route code elements) → mount **inside `pageContent`**,
     because that's what renders in the iframe where actual pages live. It reads the active list and
     renders each mechanic's `Overlay` for the current route. In tabless mode both live in the same
     document — still correct.
   - Wrap the trees in `ActivitiesProvider` (the same spots that already re-supply
     `FeatureFlagsProvider`). Each iframe runs the loader, so the data is present in every document.

6. **Revalidation + live push.** Add `/api/activities` to `LAYOUT_MUTATING_ACTION_PREFIXES` so
   submitting a code re-runs the shell loader and the bar's progress label updates without a full
   reload. For the *leaderboard*, one viewer's own `onChanged` refetch isn't enough — everyone
   else's board would sit stale until they reload. So the surface subscribes to an **SSE stream**
   (`GET /api/activities/:id/stream`, mirroring `api.notifications.stream.ts`): the write action
   calls `publishActivityChange(id)` (in-process bus, `app/lib/activity-events.server.ts`) and every
   open modal refetches on the `change` push. A periodic `sync` event is the cross-machine backstop
   (per-process bus, same trade-off as notify/staffing streams).

7. **Surface endpoint** — `app/routes/api.activities.$id.ts`, a **resource route** (no UI). Loader
   loads the activity + the user's `ActivityEvent`s + calls `summarize`; the shell modal fetches it
   and delegates rendering to the mechanic's `Surface`. The `action` calls `onAction` and returns
   its result. Gate on the `activities` flag + audience membership. There is deliberately no
   navigable `/activities` page — the surface is a modal (§2).

8. **Admin authoring** — `app/admin/routes/admin.activities*.tsx` (+ an `api.activities.$id` write
   route). CRUD: pick `kind`, set name/term/window, set audience (group + explicit list +
   role/everyone), edit `config` via the mechanic's `AdminEditor`. A **Clone** action (copy a prior
   activity, bump term + window) is what makes per-term reuse real — no deploy. Place under the
   Admin cluster that fits; Core-scoped.

9. **Notifications (optional, additive).** Add `activity.opened` (to participants when their
   activity goes live) and `activity.completed` (to the finisher / Core) to
   `app/lib/notification-events.ts`; dispatch via `notify()`. Requires the lifecycle job (§6).
   Choose defaults that preserve behavior for users with no preference rows.

10. **MCP (optional, additive).** `list_activities` / `get_activity` / `manage_activity`, mirroring
    `manage_feature_flag`, so Core can author hunts via MCP too.

## 8. Mechanic #1 — Scavenger hunt

- `kind = "scavenger_hunt"`.
- `config` (zod-validated):
  ```ts
  {
    codes: { id; value; label; location; points?; hint? }[]
    leaderboard: "public" | "core" | "off"
    instructionsUrl?: string          // informal link to the Drive clue doc, if any
    hintPolicy: { mode: "free" | "points" | "delay"; penalty: number; delayMinutes: number }
  }
  ```
- **Overlay:** for each code whose `location` matches the current path, render a discoverable
  element that reveals `code.value`. The match is via `routesMatch` (both sides normalized — leading
  slash, no trailing slash, query/hash stripped) so an authored route like `projects` or
  `/projects/` still lands on `/projects`; `location` is also normalized on save. Precise placement
  via optional `data-activity-anchor` hooks is a later, additive enhancement.
- **Surface (in the modal):** progress ("3 / 10 found"), a code-submit form, an optional **Hints**
  section, and (per `leaderboard`) the leaderboard. `bannerSummary` returns `"N/total found"` for
  the shell bar.
- **Hints (optional, per code + one policy).** Any code may carry a `hint`. How a member reveals it
  is operator-chosen per activity (`hintPolicy.mode`): **free** (reveal anytime), **points** (costs
  `penalty` points — recorded as a `hint_revealed` event so the leaderboard reflects it), or
  **delay** (locked until `delayMinutes` after the activity's start, then free). The server sends a
  hint's text only when the policy currently permits it (`resolveHintState`), so points/delay can't
  be bypassed from the client.
- **`onAction`:** a `reveal=<codeId>` input reveals a hint per the policy; otherwise a `code` input
  is a submission — normalize (trim + case-fold), match against `config.codes`, and on a fresh match
  write `ActivityEvent{ type:"code_found", refId, points }` (the unique index dedups re-submits).
- **`summarize`:** progress = `code_found` count / `codes.length`, plus the per-code hint states.
  Leaderboard groups `code_found` events by user (sum `points`, `found` count, earliest last-find as
  the completion tiebreak) and applies `hint_revealed` point penalties; only members with ≥1 find
  are ranked.

**End-to-end:** Core creates a `scavenger_hunt` activity for term 26F, window Sep 15–22, audience =
"New members 26F" group, adds codes, links the clue doc, Publishes → assigned members see the
shell bar + on-page codes, open the modal to submit codes and watch the leaderboard while they keep
exploring, → Sep 22 the window closes and the shell drops it, everything reverts → next term Core
clones it, bumps to 27W, edits codes, Publishes. No developer in the loop.

## 9. Future mechanics (proof the contract holds)

- **`theme`** — `config = { palette, bannerText }`, audience everyone, no `Surface`, no events. Its
  `Overlay` injects CSS variables at the root. Chrome-only, zero-state — exercises the spine's
  "mode with no participation" path.
- **`event`** — `config = { title, dateText, link }`. Banner only; an optional RSVP writes one
  `ActivityEvent{ type:"rsvp" }`.
- **`bingo`** / **`voting`** — `config` holds the squares/options; actions write `square_checked` /
  `vote_cast` events; progress/results derive from counts. No schema change.

## 10. Tradeoffs & gotchas

- **JSON `config` loses DB-level typing** — recovered via per-kind zod at author/read boundaries.
  Idiomatic here (`Form.draftQuestions`, `FormVersion.questions` do the same).
- **Client/server registry split is load-bearing** — mechanic *handlers* in `.server.ts`,
  *components* in client modules. Never import a server handler into a client module (the
  node-import-crashes-the-client-bundle trap that's bitten this repo before).
- **Tab-mode iframe** — the launcher (bar + modal) in the shell (`LayoutOS`), overlay in
  `pageContent` (§7.5). Getting this wrong puts codes in the wrong document or the bar inside every
  tab.
- **Surface is a modal, not a page** — the activity is about roaming the site, so a dedicated
  `/activities/:id` page would force constant navigation away and back. The surface floats over the
  current page; `/api/activities/:id` is a resource endpoint (data + submit), not a route you visit.
- **`ActivityEvent.refId` defaults to `""`, never null** — Postgres treats NULLs as distinct, so a
  nullable `refId` would defeat the dedup unique index for single-action mechanics (e.g. `rsvp`).
- **`kind` carries one value until mechanic #2 ships** — accepted cost of building the layer before
  the second user exists; it pays off the moment theme/event lands (no schema change).
- **Overlay route-match is coarse** — `data-activity-anchor` hooks are the later precision path.

## 11. Rollout / phasing

1. Schema migration + `activities` flag (off) + spine (`Activity`/`ActivityParticipant`/
   `ActivityEvent`) + client/server registries with no mechanics.
2. Scavenger-hunt mechanic (config, overlay, surface, handlers) + `/api/activities/:id` endpoint.
3. Shell wiring (loader resolve, provider, launcher bar + modal, overlay, revalidation).
4. Admin authoring + Clone.
5. Optional: lifecycle job + notifications; MCP tools.
6. Flag to Core, run the first hunt, then widen.

## 12. Open questions

- **Name.** `Activity` matches the codebase's `kind` idiom (`Page.kind`) and the user's wording;
  confirm no clash with an activity/audit-log concept before the migration.
- **Leaderboard identity.** Resolved: real names, gated by the hunt's `leaderboard` setting
  (`public` = everyone, `core` = Core only, `off`). Live via SSE (§7.6).
- **Assignment source for onboarding.** A hand-maintained "New members <term>" group, or is there a
  cleaner "joined this term" signal to auto-populate it?
- **Does the first hunt want the lifecycle job/notifications**, or is the banner enough for v1?
