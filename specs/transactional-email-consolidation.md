# Transactional Email Consolidation — Design & Plan

**Status:** Planning (design locked with Kiran 2026-08-23) · **Author:** planning
pass with Kiran · **Date:** 2026-08-23 · **Branch:** _tbd_ (`feat/outbound-messages`,
shared with the spine) · **Flag:** none

> **Phase 3** of [communication-idempotency.md](communication-idempotency.md) —
> the "Outbound Message Layer" doc. Build the outbox spine (Phase 1) and the
> `notify()` integration (Phase 2) first; this doc is about bringing the
> per-feature **transactional** email pipelines onto the same outbox.

The transactional pipelines (hiring / education / partner / signing emails) are
the tier-5/6 **naked sends** — most have no idempotency guard, no retry, and no
record of what went out. They deliberately sit **outside** `notify()` and the
preference layer, and should stay there. But they should **produce into the same
outbox** as everything else — gaining idempotency, durability, retry,
rate-control, and observability from one shared layer instead of each
reinventing (or skipping) it.

---

## 0. Why these stay outside `notify()` but still use the outbox

Per CLAUDE.md: *"Applicant/portal/partner transactional email stays on its direct
per-feature pipelines, outside the preference layer."* These sends go to
**non-members / portal addresses** (no `NotificationPreference` rows), use
**feature-owned templates**, and **must not be suppressible** by a member's
prefs (a rejection or a signed-copy receipt has to go out regardless). So they
don't route through `notify()`.

What they lack is everything the outbox provides. The consolidation is therefore
**"same queue, different producer"**: each pipeline renders its own template
(unchanged) and calls `enqueueOutbound(...)` instead of `sendEmail(...)`
directly. The outbox carries rendered content; features keep owning rendering.

---

## 1. Current state — the naked pipelines (audited 2026-08-23)

Ranked by double-send risk. "Guard" = what stops a second send today.

| Pipeline | Send site | Guard today | Risk |
|---|---|---|---|
| **Hiring extension notice** | `app/hiring/lib/extension-notice.ts` | cycle marker + per-recipient `CycleNotificationSend` unique | ✅ **gold standard** — the pattern the outbox generalizes |
| **Signing sign-request** | `app/signing/lib/notify.server.ts:112-183` | per-`(bindingId,versionId,signerUserId)` `SignRequestNotification` unique; `force` re-nudge | ✅ strong |
| **Waitlist accept** | `app/hiring/lib/waitlist.server.ts:259-471` | state gate (`Waitlisted`) + tx; **email outside the tx** | ⚠️ retry after email re-sends |
| **Hiring decision release** | `app/hiring/routes/api.decisions.$id.release.ts` | state gate (`Final`); re-release **appends a row + re-emails** | ⚠️ retry/double-POST → dup email |
| **Partner invite / magic link** | `app/partners/lib/invites.server.ts`, `app/partners/lib/magic-link.server.ts` | supersede old token; magic-link ingress rate-limit | ⚠️ both calls send |
| **Education decision / assignment / grade / session reminder** | `app/education/lib/notifications.server.ts` | none | 🔴 job re-run / retry → dups to all enrollees |
| **Signing sign-receipt PDF** | `app/signing/lib/notify.server.ts:36-101` | none (post-signature) | 🔴 webhook/retry → duplicate PDF receipt |

**Takeaway:** the two ✅ rows already *are* claim-before-send ledgers — they
hand-rolled a table each. Everything below them is a one-line
`enqueueOutbound()` conversion.

---

## 2. Design — enqueue instead of send

Each transactional send becomes an enqueue with a `forever` `dedupKey`:

```ts
await enqueueOutbound({
  channel: "email",
  dedupKey: `hiring.decision.release:${decisionId}:${recipientUserId}`, // forever
  senderId: sender.id,
  target: recipientEmail,
  recipientUserId,                 // when the recipient is a member
  subject,
  bodyHtml: renderDecisionEmail(...),   // unchanged feature-owned template
  eventType: "hiring.decision.release",
});
// inline attempt fires automatically after the enclosing tx commits
```

- **Window = `forever` for all transactional sends** — a decision / receipt /
  assignment email must never re-send for the same entity. (Contrast Phase 2
  notifications, which may opt into a coalescing window.)
- **Key format:** `{feature}.{action}:{entityId}:{recipientRef}` — one claim per
  recipient per logical event. `recipientRef` = user id when a `User`, else the
  normalized email (portal students / partners).
- **`force`** (intentional re-send — signing "re-nudge everyone", partner "resend
  invite") → enqueue with `dedupKey: null`/fresh, bypassing the claim.
- **Retry & delivery guarantee** come from the drain: a transient Gmail failure
  is retried with backoff and, if exhausted, dead-lettered to Admin →
  Communications — *not* silently dropped (the old "user must manually retry or
  the applicant never hears" hole is closed).
- **Enqueue inside the domain transaction** where one exists (decision release,
  waitlist accept) — so the email is written iff the domain change commits, and
  the two can't diverge.

### 2.1 Proposed keys per pipeline

| Pipeline | `dedupKey` | Notes |
|---|---|---|
| Decision release | `hiring.decision.release:{decisionId}:{recipientUserId}` | enqueue inside the release tx |
| Waitlist accept | `hiring.waitlist.accept:{applicationId}` | enqueue inside the accept tx |
| Interview invite / resend | `hiring.interview.invite:{interviewId}` | resend → `force` |
| Education decision | `education.decision:{applicationId}:{status}` | |
| Education assignment | `education.assignment:{assignmentId}:{userRef}` | |
| Education grade | `education.grade:{assignmentId}:{userRef}` | |
| Education session reminder | `education.session.reminder:{sessionId}:{userRef}` | |
| Sign-receipt PDF | `signing.receipt:{signatureId}` | attachment inline (spine §2.6) |
| Partner invite | `partner.invite:{inviteId}` | resend → `force` |
| Partner magic link | `partner.magiclink:{tokenId}` | keeps ingress rate-limit |

### 2.2 The two ✅ bespoke ledgers

`CycleNotificationSend` and `SignRequestNotification` already do what the outbox
does. **Leave them for this push** (they're correct; converting risks a re-blast
and needs a sent-state backfill). Retire them in a later cleanup pass, migrating
their history into `OutboundMessage` so nothing re-fires. Same stance as the
notification-side bespoke ledgers (spine §3.5).

### 2.3 Slack channel posts

- `sprint-lifecycle` already claims via the `Sprint.status` CAS before posting — leave it.
- `standup-prompts` is a genuine gap (wall-clock only) — enqueue
  `channel:"slack_channel"`, `dedupKey: slack.standup:{projectId}:{utcDay}`.

---

## 3. Rollout (after spine + `notify()` integration land)

Highest risk first; each is small and independently shippable:

1. **Sign-receipt PDF** (🔴, single call site — also exercises attachments end-to-end).
2. **Education** decision / assignment / grade / session-reminder (🔴, all in `app/education/lib/notifications.server.ts`).
3. **Hiring** decision release + waitlist accept (move the enqueue inside the tx; ⚠️).
4. **Partner** invite + magic link, and `standup-prompts` (⚠️; wire `force` into the explicit resend actions).

Each step: swap `sendEmail(...)` → `enqueueOutbound(...)`, add a test asserting
the second call is a no-op (and that `force` still sends), note the `dedupKey` in
the PR body.

---

## 4. Open decisions
- [ ] Confirm `recipientRef` = user id else normalized email (id where it exists).
- [ ] Bespoke-ledger retirement: this push leaves them; schedule the backfill-migration cleanup.
- [ ] Whether `api.email.send` (user-composed mail) rides the same keys/format — planned for spine Phase 5.
