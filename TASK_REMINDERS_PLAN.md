# Task deadline reminders — implementation plan

**Goal.** When a Task has a deadline (`dueAt`) and is not yet `Done`, every
assignee gets a Slack DM (1) 24h before the deadline and (2) right at the
deadline. Reminders use the existing `dali-os` Slack bot. If an assignee has
no Slack user mapped, the reminder for that assignee silently no-ops (but
other assignees still get theirs).

Scope is **DM-only**. No email fallback in this plan. No reminders for tasks
without `dueAt`. No reminders for status `Done` or `Cancelled`.

---

## Decisions already made (this session)

- **Scheduler**: Fly scheduled machine, 5-minute tick, hitting an internal
  HTTP route that scans and sends. Chosen because the app already lives on
  Fly; no new dependency.
- **Slack identity resolution**: batch resolve `User.slackUserId` from
  `User.daliEmail` via Slack `users.lookupByEmail`. Manual entry NOT
  exposed — the lookup is the only path.
- **First step**: the four PRs below are the agreed sequence. PR 1 starts
  on review of this doc.

---

## PR 1 — Schema + `dueAt` on tasks

**Smallest piece with independent value**: managers can put deadlines on
tasks even before any reminder logic ships.

### Schema changes (one new migration)

`prisma/schema.prisma`:

- `Task` gains `dueAt DateTime?` (nullable). No index needed yet — the
  reminder cron filters by a narrow time window and will get an index in
  PR 3 alongside `TaskReminder`.
- `User` gains `slackUserId String? @unique`. Unique so we can fail fast on
  duplicates from the email lookup.

Both columns are added nullable with no default; no backfill, no data
migration. `migration-check.yml`'s pgfence run should pass without
incident.

### UI changes

- Task detail / edit modal (`TaskBoard.tsx` neighbourhood — confirm during
  implementation): a single date+time picker labelled "Due". Clearing the
  field nulls `dueAt`. Editing the deadline in PR 3 will invalidate any
  already-fired reminders for that task; that's PR 3's concern, not PR 1's.
- Task card on the board: show a small "Due Mar 12" pill when set, dimmed
  if past and the task is not Done.

### Out of scope for PR 1

- Slack columns are added in PR 1's migration but **not populated**. No
  lookup yet, no reminders yet.
- No UI for `slackUserId`. It's an opaque column populated by PR 2.

### Done when

- `Task.dueAt` is editable through the UI and round-trips through Prisma.
- Typecheck + unit tests pass. The pgfence migration analysis on CI passes.
- No reminder code exists yet — explicitly deferred.

---

## PR 2 — Slack DM capability + identity backfill

Two independent slices, but they ship together because neither is useful
alone (a DM helper with no recipient, a Slack ID with nothing reading it).

### 2a. Extend `slack-client.ts`

Add to [dali-api/app/slack/lib/slack-client.ts](dali-api/app/slack/lib/slack-client.ts):

- `openDmChannel(slackUserId: string): Promise<{ channelId: string }>` —
  calls `conversations.open` with `users: [slackUserId]`. Cache the
  resulting channel id keyed by `slackUserId` in a small `SlackDmChannel`
  table (id, slackUserId @unique, channelId, createdAt). `conversations.open`
  is idempotent but rate-limited; caching avoids hitting it on every tick.
- `postDm(slackUserId: string, text: string): Promise<{ ts: string }>` —
  calls `openDmChannel`, then `chat.postMessage` to that channel.
- `lookupSlackUserByEmail(email: string): Promise<string | null>` — calls
  `users.lookupByEmail`. Returns null on `users_not_found`; throws on
  network/auth errors so the caller can decide.

All three use the existing fetch wrapper pattern; no new dependency.

### 2b. Token + scopes

The current bot uses bug-report scopes only. Confirm + add to the bot's
OAuth config in Slack:

- `chat:write` (already present for bug reports)
- `im:write` — open DM conversations
- `users:read` — `users.lookupByEmail`
- `users:read.email` — needed for email lookup

`SLACK_BOT_TOKEN` in `.env.example` stays a placeholder; the real token
goes into Fly secrets only. **Action item for the human**: rotate-or-extend
the bot token with the new scopes before PR 2 merges; cron will silently
fail until then.

### 2c. Backfill script + login hook

- New script `dali-api/scripts/backfill-slack-ids.ts`: scans Users with
  `slackUserId IS NULL AND daliEmail IS NOT NULL`, calls
  `lookupSlackUserByEmail` for each, writes the result. Logs the
  not-found set so an admin can chase them down. Rate-limited to ~1
  req/sec to respect Slack's 50/min on `users.lookupByEmail`.
- Auth flow (Google OAuth callback for `@dali.dartmouth.edu`): if the
  returned User has no `slackUserId`, fire the same lookup in the
  background (don't block login). Wrap in `try/catch` and log on failure;
  login must never fail because Slack is down.

### Done when

- An admin can run the backfill script locally and DMs show up via a test
  call to `postDm`.
- Auth flow populates `slackUserId` opportunistically.
- Still no reminder code — that's PR 3.

---

## PR 3 — `TaskReminder` table + reminder route

### Schema (second migration)

```prisma
model TaskReminder {
  id        String       @id @default(cuid())
  taskId    String
  userId    String       // the assignee being reminded
  kind      ReminderKind // DayBefore | AtDeadline
  // Snapshot of Task.dueAt at the time the row was created. Used to
  // detect "the deadline moved; this reminder is stale, schedule a new
  // one." Nullable for migration safety; backfill sets it from Task.
  dueAtSnapshot DateTime?
  sentAt    DateTime?    // null until sent; set to first successful DM
  createdAt DateTime     @default(now())

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id])

  @@unique([taskId, userId, kind, dueAtSnapshot])
  @@index([sentAt, dueAtSnapshot]) // for the cron scan
}

enum ReminderKind {
  DayBefore
  AtDeadline
}
```

The `@@unique` on `(taskId, userId, kind, dueAtSnapshot)` is the
idempotency key: if the deadline doesn't move, the cron can re-enqueue
without creating duplicates; if the deadline does move, a new row is
created and the old one becomes inert (its `dueAtSnapshot` no longer
matches `Task.dueAt`).

### Reminder lifecycle

Two layers — **enqueue** (creates `TaskReminder` rows ahead of time) and
**send** (the cron actually firing DMs).

**Enqueue points** (any of these creates / updates `TaskReminder` rows
for that task):

1. Task created with `dueAt` set.
2. Task updated and `dueAt` changes (the new value or null).
3. A new assignee is added to a task with `dueAt`.
4. An assignee is removed (their pending rows are deleted).

Helper `syncTaskReminders(task)` lives in
`app/projects/lib/task-reminders.ts`, runs inside the same transaction as
the task write. It:

- If `dueAt` is null or status is `Done`/`Cancelled`: deletes all
  un-`sentAt` rows for this task. (Sent rows are kept for audit.)
- Otherwise: ensures a `(DayBefore, dueAt)` and `(AtDeadline, dueAt)` row
  exists for each assignee, where `dueAtSnapshot = task.dueAt`. Rows whose
  `dueAtSnapshot` no longer matches are left alone if already sent, deleted
  if not (the deadline moved before the old reminder fired).

**Send route** `/internal/reminders/tick` (POST, shared-secret header
`X-Reminder-Secret`):

- Pulls rows where:
  - `sentAt IS NULL`
  - `dueAtSnapshot == Task.dueAt` (deadline hasn't moved since enqueue)
  - Task status is `Todo` or `InProgress` or `InReview` (not `Done` /
    `Cancelled`)
  - Fire-time window matches kind:
    - `DayBefore`: `now() ∈ [dueAt - 24h - 5min, dueAt - 24h + 5min]`
    - `AtDeadline`: `now() ∈ [dueAt - 5min, dueAt + 5min]`

  The ±5 min slack matches the cron cadence — no row gets skipped if the
  cron fires a little late.

- For each row, look up the user's `slackUserId`. If null: leave the row
  alone (don't mark sent); a backfill later may populate it and a future
  tick can send it. Cap how stale we'll resurrect: if `dueAt` is more
  than 7 days in the past, give up — mark `sentAt = now()` with a
  sentinel-ish flag (or just leave it; sent rows past their window won't
  be retried by the window check anyway).

- Send the DM via `postDm`. On success, set `sentAt = now()`. On Slack
  error, log and leave the row for the next tick (idempotent retry).

- Bound the tick: cap at 200 rows per call so a backlog can't blow the
  request timeout. Cron runs every 5 min so 200/tick = 2,400/hr —
  comfortably above any realistic load.

### DM copy (draft, finalise during implementation)

> `:hourglass_flowing_sand: Task *<task title>* is due *tomorrow at
> 5pm*. Open in dali-os: <permalink>`

> `:rotating_light: Task *<task title>* is due *now*. Open in dali-os:
> <permalink>`

### Tests

Pure unit tests on `syncTaskReminders` and the window-match logic. The
HTTP route gets one integration test that seeds a task + reminder row and
asserts the DM helper is called. Stub `postDm`; do NOT hit Slack in
tests.

### Done when

- Adding a `dueAt` to a task creates two `TaskReminder` rows per assignee.
- Changing `dueAt` reschedules (old un-sent rows go away).
- Marking the task `Done` cancels pending reminders.
- Tick route is idempotent: running it twice in the same minute produces
  exactly one DM per (task, user, kind).

---

## PR 4 — Fly scheduled machine

### Fly config

`fly.toml` (or a separate `fly.reminders.toml` if we want isolated
machines): add a `[[mounts]]`-style schedule entry, or use
`fly machine run --schedule` to create a recurring machine. Decision
during PR — both work; the inline config is auditable in git, the CLI
form is easier to tweak.

The cron target: an entrypoint script `bin/run-reminder-tick.sh` that
`curl`s the internal route with the shared secret from a Fly secret
(`REMINDER_TICK_SECRET`). Exit code propagates from `curl`; Fly will log
non-zero exits.

Cadence: every 5 minutes.

### Operational concerns

- **Observability**: tick route logs how many rows it processed and how
  many DMs sent. A non-zero error count surfaces in Fly logs; a regression
  is one `fly logs | grep reminder-tick` away.
- **Backpressure**: if Slack rate-limits, the tick returns 429-y errors;
  next tick retries.
- **Manual trigger for testing**: keep the route callable from a logged-in
  admin session (auth check accepts EITHER admin session OR the
  `X-Reminder-Secret` header), so we can fire it on demand without waiting
  five minutes.

### Done when

- A test task with a `dueAt` 6 minutes in the future fires a real DM to a
  real linked user in staging.
- `fly logs` shows the tick running every ~5 min.

---

## Failure modes + open questions

- **Email mismatch**: `users.lookupByEmail` uses Slack-side email; a user
  whose Slack email differs from `daliEmail` won't resolve. PR 2's
  backfill logs this; out-of-band fix is the admin updating one side or
  the other.
- **Deadline editing during the day-before window**: if a user moves the
  deadline 30 minutes before the day-before fire, the old row gets
  deleted before sending, the new row is enqueued, the new fire time is
  ~24h out — we don't immediately fire a "shifted deadline" reminder.
  That's a feature, not a bug, unless you tell me otherwise.
- **Timezones**: `dueAt` is stored UTC. The DM text formats in the
  recipient's local time? Or the lab's default tz? Default to America/New_York
  in PR 3 unless we have a per-user tz already (we don't).
- **Multi-assignee task**: every assignee gets their own DM. No "team
  channel" fan-out in this plan.
- **Anti-spam**: a task with 20 assignees that flips status back and
  forth could create a lot of churn. The `@@unique` constraint prevents
  duplicate rows but doesn't throttle send count. Probably fine for the
  scale of one lab.

---

## Out of scope (explicitly)

- Email reminders.
- Reminders for sub-tasks (`Task.checklist` is a JSON blob; no per-item
  deadlines).
- Reminders for Announcements / Notifications (those have their own
  `dueAt` semantics; not touched here).
- A standalone "my upcoming tasks" digest. That's a future PR.
- Snooze / dismiss UX in Slack (would need an interactive Slack app, not
  a bot DM). Future PR if desired.
