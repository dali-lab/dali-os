# DALI OS — Jobs & Notifications: Wiring Opportunities

_Compiled July 15, 2026, after landing the background job runner + notification delivery layer (PR #912). Companion to [feature-opportunities.md](feature-opportunities.md) — this narrows to what the new infrastructure makes cheap._

The two primitives from PR #912 and what "wiring in" means for each:

1. **Notification delivery** — `notify()` (`dali-api/app/lib/notify.server.ts`) + the event registry (`app/lib/notification-events.ts`). Adding an emitter = one registry entry + one `notify()` call; the settings-page row, per-user channel preferences (in-app / email / digest / Slack DM), and digest grouping all derive from the registry automatically.
2. **Job runner** — `app/jobs/registry.ts`. Adding a job = one handler + one registry entry; the DB row, Admin → Jobs panel row (toggle, interval, declared settings knobs), and tick pickup all follow.

---

## 1. New emitters (one registry entry + one `notify()` call each)

| Emitter | Evidence / trigger point | Notes |
|---|---|---|
| **Task assignment** | Task create/assign emits nothing today (verified during the #912 build — only due-date reminders exist) | `task.assigned`; probably the most-felt missing notification in daily use |
| **Staffing assignment published** | Finalize creates the Slack channel + roster post, but no per-member notification; the old dormant `NotificationEvent` seed literally anticipated `staffing_assignment_published` | `staffing.assigned`, emitted from `staffing-finalize.server.ts` |
| **Meeting cancelled / rescheduled** | `cancelScheduledMeeting` only *hides* the invite — nobody is told | `meeting.cancelled` in `app/lib/scheduled-meeting.ts` |
| **Doc/comment @-mentions** | feature-opportunities §3: "Comment @-mentions don't notify anyone"; core Notion-replacement expectation | `collab.mention` + one call site in the comment pipeline |
| **Task comments → assignees** | `TaskComment` writes notify no one | `task.comment` |
| **GitHub events → task assignees** | Webhook handler exists (`api.webhooks.github.ts`) but tells no one when an issue closes / syncs a task | `task.github_update` |

---

## 2. New jobs (one `registry.ts` entry each; toggle/settings/panel come free)

- **Sprint lifecycle automation.** The #3 pick in feature-opportunities and the showpiece: close sprints past `endsAt`, roll unfinished tasks to backlog/next sprint, post a summary to the project's Slack channel. Almost entirely existing primitives.
- **Form open/close windows.** The top-ranked forms-builder gap. Needs two schema fields (`opensAt`/`closesAt`) plus a 1-minute job flipping `published` — same shape as scheduled announcements.
- **Hiring interview reminders (24h/1h).** Email templates + ICS infra already exist (`interview-emails.ts`); a job just fires them on schedule. Applicant-facing, so it stays on the template pipeline, outside the preference layer.
- **Retention janitor.** `Notification`, `TaskReminder`, and `MeetingReminderLog` grow unboundedly now. Monthly sweep deleting read notifications and stale ledger rows, with `retentionMonths` as a panel knob.
- **Standup prompts.** Small job posting to project Slack channels (feature-opportunities §2, proactive Slack).
- **Term rollover checklist.** Bigger, but the mechanical parts (close offerings, refresh eligibility, group updates) are exactly job-shaped; surface the judgment calls as notifications to Core.

---

## 3. Channel / infra wiring

- **ICS on meeting-invite emails.** feature-opportunities §2: "Meeting invites never send an `.ics` — external participants get nothing." Hiring's RFC 5545 builder (`interview-ics.ts`) is borrowable and `sendEmail` already takes an `ics` param — this is an enrichment of the existing email channel, not a new one.
- **Mobile push (when the sidekick app lands).** Push becomes a fourth column on exactly this registry/preference structure — `NotificationPreference` gains a `push` toggle, `notify()` gains a sender. Keeping the eventType taxonomy stable is what keeps this cheap.
- **MCP tools.** `list_my_notifications` exists, but an assistant can't read or set preferences. With the AI slash-command track coming, `set_notification_preference` is trivial on this schema; feature-opportunities §3 also flags forms/meetings/groups as MCP write-coverage gaps.

---

## Known structural limits (from the #912 audit — plan around, don't fight)

- Renaming an `eventType` requires backfilling `Notification` + `NotificationPreference`; adding/removing is cheap.
- A second meeting-reminder lead tier (e.g. 1h + 15m) needs a `MeetingReminderLog` key migration.
- Per-user digest send times would be a redesign (the 9am gate rides on the per-*job* `lastSuccessAt` cursor).
- Registry default changes only reach users who never saved the settings page (saving freezes explicit rows).

---

## Top three picks

1. **Task assignment emitter** — biggest daily-felt gap, smallest change.
2. **Sprint close-out automation** — visible, delightful, proves the whole stack end-to-end.
3. **Form open/close windows** — unblocks the forms roadmap already in flight.

All follow-up PRs after #912 lands — it's at a good reviewable size.
