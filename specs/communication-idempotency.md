# Outbound Message Layer — Design & Plan

**Status:** BUILT 2026-08-23 — PR #1368 → staging · **Author:** planning
pass with Kiran · **Date:** 2026-08-23 · **Branch:** `feat/outbound-messages` ·
**Flag:** none (schema-additive; behavior opt-in per call)

> Companion doc: [transactional-email-consolidation.md](transactional-email-consolidation.md)
> is Phase 3 — mapping the per-feature transactional email pipelines onto the
> outbox defined here. Read this one first; it owns the table, the drain, and the
> `notify()` integration everything else sits on.
>
> **Formerly "Communication Idempotency."** The design climbed an altitude: rather
> than a lightweight claim-ledger, we're building a real **transactional outbox**.
> The outbox row *is* the idempotency claim, so idempotency comes for free, plus
> transactional consistency, automatic retry, egress rate control, and
> observability. Decisions from the design thread are recorded in §5.

Introduce a single **outbound message layer** — a transactional outbox — that
every email and Slack send flows through. A message is written as an
`OutboundMessage` row (in the same DB transaction as its triggering domain
change), attempted inline immediately, and swept by a single-leased drain job
that retries with backoff, respects per-sender daily caps, and dead-letters
what it can't deliver. The row's unique `dedupKey` makes every send **idempotent**;
the queue makes it **durable, observable, and rate-controlled**. In-app
notifications keep using the `Notification` row itself as their claim.

---

## 0. The model in one paragraph

Producers (`notify()` and the transactional pipelines) don't call Gmail/Slack
directly anymore — they **enqueue** an `OutboundMessage` with rendered content and
a `dedupKey`. Enqueue is the idempotency claim: a duplicate producer (retry,
re-run, double-submit) hits the unique constraint and no-ops. Right after the
enqueuing transaction commits, the producer fires a **best-effort inline drain**
of the rows it just wrote, so interactive emails go out immediately. Anything
still `Pending` — a transient failure, a crash, a rate-deferred message — is
swept by the **drain job**, which is single-leased (so egress pacing needs no
distributed limiter), wraps each send in the existing `retry()` helper, checks a
per-sender daily cap before sending, and moves exhausted messages to `Dead` for
an operator to inspect and retry. In-app notifications are unchanged in spirit:
the `Notification` row is their claim, now with an optional `dedupKey`.

---

## 1. Current state (audited 2026-08-23)

No shared idempotency mechanism, and — the finding that drove the outbox — **no
egress control of any kind**.

### 1.1 The primitives have no idempotency
- **`notify()`** (`app/lib/notify.server.ts:103-313`) dedupes recipients *within
  one call* only (`:115-118`). Its own comment: *"duplicates are caller bugs we
  absorb."*
- **`Notification`** (`prisma/schema.prisma:1917`) has no unique constraint / no
  dedup column; `emailedAt`/`slackDmAt` are delivery flags, not keys.
- **`sendEmail()`** (`app/lib/gmail.ts`) and **`sendDm()`**
  (`app/slack/lib/slack-client.ts:83-87`) are naked wrappers — no idempotency
  key, no retry, no log. Neither Gmail send nor Slack `chat.postMessage` supports
  a provider idempotency key, so exactly-once *to the provider* is unachievable;
  the ceiling is "exactly-once decision to send, committed in our DB first."
- **The job lease is at-least-once** (`app/jobs/runner.server.ts:97-106`): crash
  recovery re-runs the whole handler. Sending handlers must self-dedup.

### 1.2 The idempotency spectrum in use (the inconsistency)
Semantically identical operations sit at different protection tiers by author:

| Tier | Mechanism | Where |
|---|---|---|
| **1. Ledger + unique, claim-before-send** | insert keyed row; unique violation → skip | `MeetingReminderLog` (`schema.prisma:2045`), `InterviewReminderLog` (`:736`), `SignRequestNotification` (`:1656`), `CycleNotificationSend` (`:1435`, hiring extension notice — **gold standard**) |
| **2. Ledger, mark after send** | claim, then `sentAt=now` post-send | `TaskReminder` (`:3065`) |
| **3. State column on the domain row** | CAS-claim or send-then-mark | `ScheduledAnnouncement.sentAt` (`:4433`), `EducationSession.reminderSentAt`, digest's `Notification.emailedAt` |
| **4. Notification table as ad-hoc ledger** | `findFirst` before `notify()` | `app/education/lib/feedback.server.ts:191-209`, onboarding `welcome.server.ts` |
| **5. State-transition as implicit guard** | relies on "state X once"; email sits outside | hiring decision release (re-emails), waitlist accept (email outside tx) |
| **6. Naked** | direct send | education assignment/grade/decision emails, sign-receipt PDF, `standup-prompts` |

### 1.3 The two problems the outbox closes
- **(A) Cross-fire** — same logical event dispatched twice (re-run, retry,
  double-submit, "Run now"). Tiers 4–6 fail here.
- **(B) Send-then-mark race** — mark-after-send double-delivers on a crash between
  send and mark. Affects the **digest** (`app/lib/notification-digest.server.ts:207-216`),
  task/session reminders.

### 1.4 Rate limiting today (reviewed 2026-08-23) — all ingress, zero egress
- **`checkRateLimit()`** (`app/lib/rate-limit.ts`) — in-memory sliding-window
  counter (`:50-54`), per IP/key, returns 429. **Per-process** (resets on deploy,
  effective limit ×machines) — fine for abuse protection, unusable as a hard or
  cross-machine quota. Every usage is **ingress** (auth, oauth, `api.ai.doc`
  burst, upload, forms.fill, mcp, magic-link, `api.email.send`).
- **`AiUsage`** (`schema.prisma:1509`, `@@unique([userId, day])`) — the only
  durable cross-machine quota; the AI assistant's second tier. The shape we
  reuse for per-sender daily caps.
- **`retry()`** (`app/lib/retry.ts`) — generic backoff + `shouldRetry`. The
  drain's per-message retry primitive, as-is.
- **Egress: none.** `sendEmail`/`sendDm` and `notify()`/digest send in tight
  loops with no throttle, retry, or quota awareness — a big blast or digest can
  hit Gmail per-second/daily caps and today just **fails and drops**. This is the
  latent risk the outbox owns.

---

## 2. Architecture

### 2.1 The table — `OutboundMessage`

```prisma
model OutboundMessage {
  id              String    @id @default(cuid())
  channel         String    // "email" | "slack_dm" | "slack_channel"

  // Idempotency: enqueue is the claim. Nullable → NULLs distinct in Postgres,
  // so unkeyed sends never collide (backward compatible, opt-in dedup).
  dedupKey        String?

  // Routing
  senderId        String?   // EmailSender/grant to send through; null = resolve default
  target          String    // rendered destination: email addr(s), slack user id, or channel id
  recipientUserId String?   // when the recipient is a member — powers the "what did we send X" view

  // Rendered payload (the layer carries content; features own rendering)
  subject         String?
  bodyHtml        String?   @db.Text
  bodyText        String?   @db.Text
  slackText       String?
  ics             String?   @db.Text
  attachments     Json?     // [{ filename, mimeType, contentBase64 }] — see §2.6

  // Lifecycle
  status          String    @default("Pending") // Pending | Sending | Sent | Dead | Canceled
  attempts        Int       @default(0)
  nextAttemptAt   DateTime  @default(now())     // also the claim-lock stamp while Sending
  lastError       String?
  sentAt          DateTime?

  // Provenance / audit
  eventType       String?   // notify() eventType or a feature action label
  createdByUserId String?
  createdAt       DateTime  @default(now())

  @@unique([channel, dedupKey])
  @@index([status, nextAttemptAt])   // the drain's claim query
  @@index([recipientUserId])         // admin "history for X"
  @@index([senderId, sentAt])        // per-sender volume
}
```

### 2.2 Idempotency — two mechanisms, kept separate

The design thread's key clarification: "dedup window" was really conflating two
things. We build them as distinct mechanisms.

- **Idempotency = exactly-once for a *fixed* logical event.** Always `forever`.
  This is the whole correctness ask and *all* the transactional pipelines want
  only this. Implemented as the **atomic unique claim**:
  - outbound → `OutboundMessage @@unique([channel, dedupKey])` (enqueue = claim)
  - in-app → `Notification` gains `dedupKey String?`, `@@unique([recipientUserId, dedupKey])` (the row = claim)
  - `dedupKey` format: `{feature}.{action}:{entityId}:{recipientRef}` — one claim
    per recipient per logical event. `recipientRef` = user id where the recipient
    is a `User`, else a normalized (lowercased/trimmed) email.
  - **`force`** (intentional re-send — "resend invite", signing "re-nudge") →
    enqueue with `dedupKey = null` (or a fresh unique suffix) so it always sends.

- **Coalescing = suppress a burst of a *recurring* notification** (5 comments →
  1). Opt-in on a few noisy `notify()` events; it **drops** the 2nd–Nth (it does
  *not* aggregate/rewrite content — that's a separate, larger feature). Because
  coalescing is a UX nicety, not correctness, it's a **best-effort sliding-window
  check** — `findFirst` a matching recent row within `now - window` before
  creating/enqueuing — **no bucketing, no atomic claim needed** (a rare race just
  yields the un-coalesced behavior, which is harmless). Window lives per event in
  `app/lib/notification-events.ts`:
  ```ts
  "task.comment":      { ..., coalesce: { window: "1h" } },
  "collab.comment_reply": { ..., coalesce: { window: "30m" } },
  ```

### 2.3 Producers

**`notify()`** (member-facing, preference-aware) becomes an enqueuer:
1. resolve per-recipient channels from `NotificationPreference` + registry defaults (unchanged);
2. optional coalesce check per recipient (§2.2), skip if suppressed;
3. **in-app** → create `Notification` (with `dedupKey` when keyed; per-recipient inserts on the keyed path — a batch unique-violation aborts the whole statement; unkeyed keeps the fast `createManyAndReturn`);
4. **instant email** → render via `renderNotificationEmail` (at enqueue, using request-time data) and enqueue `OutboundMessage(channel:"email")`;
5. **slack DM** → enqueue `OutboundMessage(channel:"slack_dm")`;
6. fire the **inline drain** (§2.5) for the just-enqueued ids, unawaited/best-effort.

`emailedAt`/`slackDmAt` on `Notification` remain as *delivery-status* flags for
the UI, stamped by the drain on success (via `recipientUserId` + `eventType`
correlation, or an optional `notificationId` FK on the outbox row).

**Transactional pipelines** (Phase 3) enqueue `OutboundMessage` directly — no
`Notification` row, no preference layer — with their own rendered template and a
`forever` `dedupKey`. See companion doc.

**The digest** becomes a producer too: one `OutboundMessage` per user
(`dedupKey: digest:{userId}:{windowId}`, forever), which **closes problem (B)** —
the enqueue is the claim, so a crash can't re-send; source rows still get
`emailedAt` marked so they're not re-digested.

### 2.4 The drain job (single-leased) — retry, dead-letter, egress pacing

Registered in `app/jobs/registry.ts`; runs each tick, plus on-demand inline
(§2.5). Because the runner's CAS lease guarantees one drainer at a time, all
pacing is **local logic** — no distributed limiter.

```
claim: updateMany(where status=Pending AND nextAttemptAt<=now, set status=Sending, nextAttemptAt=now+lockMs)
       (CAS claim — an inline attempt and the tick can't double-process a row;
        stale "Sending" rows are reclaimed once nextAttemptAt passes)
for each claimed row, bounded to `maxConcurrency`:
  resolve sender; check SenderDailyUsage(senderId, utcDay):
    count >= cap  → defer: status=Pending, nextAttemptAt = next UTC midnight; continue   (§2.6 rate limit)
  retry(() => send(row), { backoffsMs })                     (reuses app/lib/retry.ts)
    success        → status=Sent, sentAt=now; increment SenderDailyUsage; mark Notification.emailedAt/slackDmAt
    transient fail → status=Pending, attempts++, nextAttemptAt = now + backoff(attempts), lastError
    exhausted/perm → status=Dead, lastError                  (surfaces in Admin → Communications)
```

### 2.5 Inline attempt (low latency for interactive flows)

After the enqueuing tx commits, the producer calls a best-effort
`drainNow(ids)` — a bounded, error-swallowing pass over just those rows — so
magic-links, "resend invite", etc. send within the request instead of waiting
for the next 60s tick. Failures simply stay `Pending` for the tick drain. Never
blocks the response on a provider error.

### 2.6 Egress rate limiting — per-sender daily cap (build now)

Caps are a property of the *sender* (a Workspace mailbox and a group alias differ),
so they live on the sender, not the drain:

```prisma
model SenderDailyUsage {          // mirrors AiUsage exactly
  senderId String
  day      String                 // UTC "YYYY-MM-DD"
  count    Int    @default(0)
  @@unique([senderId, day])
}
```

- The `EmailSender`/sender config gains an editable `dailyCap Int?` (null = uncapped).
- Drain checks `count >= dailyCap` **before** sending; at cap it **defers**
  (`nextAttemptAt = next UTC midnight`) — never drops — and flags the sender as
  capped in Admin → Email Senders.
- Increment atomically on successful send (AiUsage-style upsert). Within one
  drainer batch, track the running count in memory for precision; persist across
  ticks/days via the row.
- **Deferred to a follow-up:** per-second pacing / proactive throttling. The
  backoff-on-quota-error path above degrades gracefully without it.

**Attachments (§2.1):** the sign-receipt PDF carries an attachment. v1 stores it
inline as base64. Because inline-attempt usually sends within seconds, the heavy
payload is short-lived; `retention-janitor` **strips `bodyHtml`/`attachments`
from `Sent` rows** after a short horizon while keeping the lightweight metadata
row for the audit trail. Watch-item: row size on large blasts.

### 2.7 Admin surfaces (editable in UI — all on existing conventions)

- **Admin → Jobs** — the drain job's declared settings: `batchSize`,
  `maxConcurrency`, retry `backoffsMs`, lock TTL. (Cadence = the job interval,
  already editable.)
- **Admin → Email Senders** — per-sender `dailyCap` + a "capped today" indicator
  (extends the existing sender-health surface).
- **Admin → Communications** *(new page)* — the outbox: rows filterable by
  recipient / entity / status, with operator actions **Retry** (a `Dead` row) and
  **Cancel** (a `Pending` row). This is where "what did we send this applicant,
  and did it land?" becomes answerable.

---

## 3. Rollout (phased; each phase independently shippable)

1. **Spine.** `OutboundMessage` + `SenderDailyUsage` migrations; enqueue API;
   `drainNow(ids)` + drain job (status machine, `retry()`, CAS claim); per-sender
   cap + defer-on-cap; Admin → Jobs knobs. Unit tests: claim/skip, retry→dead,
   cap-defer, inline vs tick no double-send.
2. **`notify()` integration.** `Notification.dedupKey` + unique; route email/Slack
   channels through the outbox; move the **digest** onto the outbox (closes B);
   add `coalesce` to noisy events. Backward compatible — unkeyed = today.
3. **Transactional pipelines** onto the outbox, pipeline-by-pipeline (companion doc).
4. **Admin → Communications** page + per-sender cap UI in Email Senders.
5. **Cleanup (later).** Route `api.email.send` through the outbox; retire the
   tier-1/2 bespoke ledgers — **each migration must backfill sent-state** or an
   empty table re-blasts.

---

## 4. Non-goals / explicit deferrals
- Content **aggregation** ("5 new comments" as one line) — coalescing only drops.
- Per-second egress throttling / token-bucket pacing (§2.6).
- Bounce / deliverability tracking (additive on `OutboundMessage` later).
- Push (mobile) as a channel — slots in as another `channel` value when the app lands.

---

## 5. Decisions locked (design thread 2026-08-23)
- **Outbox model (Option C)**, not a lightweight claim-ledger.
- **Sliding window** for coalescing, **no interval bucketing**; coalescing is
  best-effort (not an atomic claim).
- **Two mechanisms:** `forever` idempotency (atomic unique claim) everywhere;
  window applies only to coalescing.
- **delete-on-failure is superseded** by the outbox retry → dead-letter path.
- **Per-sender daily cap: build now** (AiUsage-shape counter, defer-on-cap).
- **`api.email.send` routes through the outbox** (keeps its ingress limiter).
- **UI-editable:** drain knobs in Admin → Jobs · sender caps in Admin → Email
  Senders · queue operation in a new Admin → Communications page.
- **Bespoke ledgers:** leave in place for the feature push; migrate w/ backfill later.

### Still open (naming / tuning — not blocking)
- [ ] Default `dailyCap`, `maxConcurrency`, `backoffsMs` values.
- [ ] `notificationId` FK on `OutboundMessage` vs. correlate by `recipientUserId`+`eventType` for delivery-flag marking.
- [ ] `SenderDailyUsage` naming; whether `dailyCap` lives on the existing sender model or a new config row.
