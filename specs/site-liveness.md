# Site Liveness — Implementation Spec

Branch: `feat/site-liveness` (off `origin/staging`). **One combined PR → staging.**
Three features. Feature 4 (motion/optimistic UI) intentionally deferred.

House rules: no new dependencies; match existing patterns; comment only non-obvious *why*;
honor `prefers-reduced-motion`; never write `prisma.notification` directly. No new
notification event types are added by any of these features.

Ownership: three subagents work **disjoint** files. The **three shared files are
integrated by the main thread, not the subagents**:
- `app/components/Layout.tsx` (F1 provider mount + F3 revalidate)
- `app/members/routes/members.tsx` (directory: loader fields + dot + New/birthday badges)
- `app/members/components/MemberProfileView.tsx` (profile header: status label + New/birthday)

---

## Feature 1 — Persistent presence (heartbeat + status dot)  [Agent A]

### Data (Prisma)
- Add `User.lastActiveAt DateTime?` (nullable).
- Add `User.hideActivity Boolean @default(false)` ("appear away").
- **No local DB available** — do NOT run `prisma migrate dev`. Hand-author the migration:
  create `prisma/migrations/<timestamp>_add_user_presence/migration.sql` with two additive
  statements (both safe/non-destructive), matching `schema.prisma`. Follow existing migration
  naming. Main runs `npx prisma generate` centrally.

### Write path (recording) — option C, throttled bump in the auth layer
- In `app/lib/auth.ts` (`requireAuth`, where `rollSession` is already called fire-and-forget),
  add a throttled `bumpLastActive(userId)`: single conditional write
  `UPDATE "User" SET "lastActiveAt" = now() WHERE id = $1 AND ("lastActiveAt" IS NULL OR "lastActiveAt" < now() - interval '60 seconds')`.
  Fire-and-forget (`.catch(() => {})`). Applies to all authed users incl. partners.
- **Record always**; `hideActivity` gates *display*, not recording (so toggling off restores instantly).

### States (derive from lastActiveAt)
- `active`  < 5 min      → solid green dot (`bg-accent-green`)
- `recent`  < 60 min     → hollow amber ring dot
- `away`    ≥ 60 min / null / hideActivity → no dot
- Your own userId always renders `active`.

### Read path (display) — 60s status poll
- New `GET /api/presence/statuses?ids=a,b,c` → `{ [userId]: { lastActiveAt: ISO|null, state } }`.
  Auth required. Users with `hideActivity` return `state: "away"`, `lastActiveAt: null`. Cap ids (~200).
- New `PresenceStatusProvider` (React context): collects userIds of mounted status-aware avatars,
  batches a fetch every 60s, exposes `useAvatarStatus(userId)`. Mounted app-wide — **Main mounts it in Layout.tsx**.

### Avatar API (`app/components/ui/Avatar.tsx`)
- Add optional `userId?: string`. Show the dot when `userId` present AND `size` ∈ {sm, md, lg}
  (xs/utility suppressed). Absolutely-positioned dot bottom-right with a ring matching card bg.
- Tooltip via existing `Tooltip`: `Active now` (<5m) / `Active N minutes ago` (<60m) /
  `Active N hours ago` (<24h) / `Active N days ago` (≥24h) — correct singular/plural.
  `away` with no timestamp → no dot, no tooltip.
- Add pure helper `formatLastActive(date, now)` + **unit tests** (match repo test style).

### Settings — "Appear away"
- Add a toggle in Settings → Workspace (match the existing tabless-mode toggle pattern), posting
  `User.hideActivity`. Find the workspace-settings route / `AccountSettingsBlock`.

### Call sites (Agent A threads `userId` into sm/md/lg Avatars — EXCEPT the 2 shared files)
- e.g. `MemberCard`, `OfferingCard`, `CourseHub` instructors, `admin.members`, `ReviewSummary`,
  `MentorGrid`. Skip xs contexts (`CommentsRail`, `InstructorPicker` chips, ⌘K, tight facepiles).
- **Do NOT edit `members.tsx` or `MemberProfileView.tsx`** — Main integrates those.

---

## Feature 2 — Warmth (birthdays + 'New' badge)  [Agent B]  — no migration

### 'New' badge
- Helper `isNewMember({ onboardedAt, createdAt }, now)`: true if `(onboardedAt ?? createdAt)`
  within 30 days. Active members only (caller ensures). + unit tests.
- `<NewBadge>` small pill component (brand tint, label "New").
- Surfaces directory rows + profile header → **Main integrates** (Agent B only provides helper + component).

### Birthdays
- Helpers: `isBirthdayToday(birthday, now)`, `formatBirthdayMonthDay(birthday)` (month/day ONLY,
  never year), `birthdaysThisWeek(members, now)` (year-agnostic; handle month-boundary wrap). + tests.
- `<BirthdayBadge>` (🎂) shown when `isBirthdayToday`.
- **Home "Birthdays this week" card** — new component + loader query in `home.tsx` (Agent B owns home.tsx):
  active members with a birthday in the current week, month/day match. Collapses to `null` when empty.
- Directory + profile 🎂 on the day → **Main integrates**. Members only; blank birthday → nothing.

---

## Feature 3 — Live counts  [Agent C]  — no server change

- Consume the existing `GET /api/notifications/stream` SSE in the web shell. Extend
  `usePolledCounts` in `app/components/NotificationBell.tsx` (or a small `useNotificationStream` hook):
  open `new EventSource("/api/notifications/stream", { withCredentials: true })`; on `change` and
  `sync` → run the existing refresh AND trigger `useRevalidator().revalidate()` so the My Tasks list
  updates too. Keep the 60s poll as fallback. Close on unmount. Mirror the `StaffingBoard` EventSource pattern.
- Sidebar counts (My Tasks + unread) tick instantly; ≤60s in prod cross-instance (sync fallback). No toast.
- Layout.tsx wiring (revalidate) → **Main integrates** (shared with F1). Agent C owns NotificationBell.tsx.

---

## Verification (Main, central)
`cd dali-api && npm install && npx prisma generate && npm run typecheck && npm test && npm run build`
PR note: migration hand-authored (no local DB) — two additive nullable/defaulted columns (safe);
applies on deploy via `prisma migrate`. Presence adds an authed `/api/presence/statuses` route and a
per-request throttled `User.lastActiveAt` write.
