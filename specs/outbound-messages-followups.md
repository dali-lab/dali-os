# Outbound Message Layer — Follow-ups

**Status:** Backlog · **Date:** 2026-08-24 · **Context:** after PR #1368 (the outbox)
and the "migrate every direct `sendEmail` caller" pass. Companion to
[communication-idempotency.md](communication-idempotency.md) and
[transactional-email-consolidation.md](transactional-email-consolidation.md).

As of the migration pass, **every direct `sendEmail` call site is on the outbox**
(`enqueueOutbound` + `drainNow`) — `notify()`, the digest, and all transactional
pipelines (hiring, education, partner, signing, admin test-send, onboarding,
portal apply, extension notice, interview lifecycle). The only remaining
`sendEmail` reference is its definition in `app/lib/gmail.ts` and the drain in
`app/lib/outbound.server.ts`. This doc tracks what's intentionally left.

---

## 1. Idempotency hardening (send is on the outbox; dedupKey is not yet forever)

Some migrated sends were given **no `dedupKey`** (they always send). That's
correct where the action legitimately recurs or is a manual "send again", but a
few could take a forever key to survive a double-click / retry:

- **Partner lifecycle emails** (`partner-emails.server.ts`: decision
  accepted/rejected, learn-more, triage, meeting invite) — currently keyless.
  To make idempotent, thread the `PartnerApplication` id to `send()` and key
  `partner.decision:{applicationId}:{kind}`. (Member-conflict + the generic
  helper should stay keyless.)
- **Onboarding bulk email** (`welcome.server.ts`) and **admin template
  test-send** — deliberately keyless (both are manual, resend-on-purpose flows).
  Leave as-is.
- Interview **reminders / reassignment / location-change** are intentionally
  keyless (reminders are guarded by the job's `InterviewReminderLog`; the other
  two legitimately recur). Only **cancel** got a forever key.

All of these already gain retry + per-sender cap + Admin → Communications
history from the outbox regardless of the key.

---

## 2. Deferred infrastructure (from the original design)

- **Retire the two bespoke ledgers** — `CycleNotificationSend` (extension
  notice) and `SignRequestNotification` (sign requests). Both are correct today
  and now also carry an outbox `dedupKey`, so they're redundant. Removing the
  tables needs a **backfill migration** (copy their "already sent" history into
  `OutboundMessage`/keys) so a migrate can't re-blast. Data-losing → prod-gated.
- **Proactive per-second egress throttling** — only the per-sender *daily* cap
  is built; the drain defers on a Gmail quota error but doesn't pre-pace. Add a
  token-bucket in the (single-leased) drain if blast volume ever approaches
  Gmail's per-second limits.
- ~~**Coalescing aggregation** — windowed coalescing currently *drops* the
  2nd–Nth notification.~~ **BUILT 2026-08-24 (feat/notification-merging).**
  A burst within an event's window now *merges* into the existing in-app row
  instead of dropping: the row is refreshed to the latest preview, re-lit unread,
  bumped to the top of the feed (sliding the window forward), and its new
  `Notification.coalesceCount` column incremented; the body reads "N new
  comments · latest: …" via a per-event `coalesceNoun` in the registry.
  Email/Slack stay suppressed to one-per-window (in-app only re-surfaces).
- **Bounce / deliverability tracking** — additive on `OutboundMessage` (a
  `bouncedAt` + a Gmail push/webhook or SMTP feedback loop). Would make Admin →
  Communications show hard bounces, not just send failures.
- **Push (mobile) channel** — slots in as another `channel` value on
  `OutboundMessage` when the sidekick app lands (see [[project_mobile_app]]).

---

## 3. Slack posts not yet on the outbox

The migration targeted `sendEmail`. Slack **DMs** already flow through the outbox
via `notify()`, and `standup-prompts` posts via the outbox. Two **channel-post**
call sites still post directly (both are one-shot and state-gated, so low
double-send risk, but they don't get retry/observability):

- `sprint-lifecycle.server.ts` — roster/close-out summary (CAS-gated on
  `Sprint.status`).
- staffing **finalize** — the confirmed-roster channel post.

Route these through `enqueueOutbound({ channel: "slack_channel", ... })` if we
want uniform retry + history for Slack too.

---

## 4. Staging validation checklist (CI can't exercise these)

- [ ] Apply migration `20260823200000_outbound_message_layer` on a prod-like DB.
- [ ] Real Gmail delivery through the drain: inline send, a forced failure →
      backoff → dead-letter, and a `Dead` row's **Retry** from Admin →
      Communications.
- [ ] Real Slack DM + channel post in prod (prod-gated; can't test off-prod).
- [ ] Per-sender `dailyCap`: set a low cap, confirm over-cap sends **defer** to
      the next UTC day and the sender shows "capped".
- [ ] Admin → Communications (filter / retry / cancel) and the Email Senders cap
      UI render + act correctly against real rows.
- [ ] `api.email.send` async behavior is acceptable for the release / batch
      sender flows (returns on enqueue, no synchronous Gmail error).
