---
title: Admin area
summary: What each Admin section does, including background jobs, feature flags, AI usage, the audit log, analytics, email senders and who can use each tool.
audience: [core, admin]
paths: [/admin, /admin/platform/jobs, /admin/platform/flags, /admin/insights/ai-usage, /admin/insights/audit-log, /admin/insights/analytics, /admin/messaging/senders, /admin/accounts/users, /admin/accounts/security]
keywords: [admin, jobs, background jobs, run now, feature flag, rollout, ai usage, tokens, audit log, analytics, senders, site users, log in as, payroll, security]
---

Admin holds the system-level tools: the platform, messaging, usage and accounts. It appears in the sidebar for Core and Admin. Some tools are limited to Admin, as noted below. Everyone else who opens an Admin page lands on the home page.

The [Admin overview](/admin) shows what needs attention right now. Each sidebar entry is a section, and its tools are tabs along the top of the page.

## Platform

**Jobs** ([/admin/platform/jobs](/admin/platform/jobs)) lists the background jobs that run on a schedule, such as digests, reminders and scheduled announcements. Each row shows a status (**Healthy**, **Failing**, **Running**, **Paused** or **Not run yet**), the schedule, and the last and next run.

- Change the interval (minutes between runs) and any job settings, then select **Save**.
- Use the switch at the end of the row to pause or resume one job.
- Select **Run now** to run it immediately. Confirm first, because some jobs email or Slack members right away. A failing job shows **Retry now** and its error message.
- Digest jobs only send inside their time window, so **Run now** outside it does nothing.

**Feature flags** ([/admin/platform/flags](/admin/platform/flags)) controls who sees features that are still being rolled out. Search for a flag, open it, and choose who it is on for: **Everyone**, one or more roles, or named people. Select **Save**. Turning a flag on for everyone asks you to confirm. Flags are off by default, and a flag only works for someone if it is switched on and they match its targeting.

## Messaging

**Outbox** shows every email and Slack message the app has sent or tried to send, with **Retry** and **Cancel send**. See [Core tools](/help/articles/core-tools) for how to use it.

**Senders & inboxes** ([/admin/messaging/senders](/admin/messaging/senders)) lists the Gmail account behind each kind of email, with a status (**Connected**, **Capped**, **Error** or **Not set up**) and a daily cap you can edit. If a sender is disabled, email of that kind falls back to another sender. Only admins can change shared inbox categories, on the same page.

## Insights

**Analytics** ([/admin/insights/analytics](/admin/insights/analytics)) shows site usage, page view trends, rarely visited pages, and client errors.

**AI usage** ([/admin/insights/ai-usage](/admin/insights/ai-usage)) shows, for a date range you choose, total tokens, requests, how many members used AI, an estimated cost, and a table per member with requests, tokens, estimated cost and last used. Cost is an estimate. Token counts are best effort, so a request can show up without tokens if it was canceled or failed.

**Audit log** ([/admin/insights/audit-log](/admin/insights/audit-log)) records admin actions across the site. Filter by person (name, email, id or IP address, where a partial IP like 129.170 matches the range), **Area**, **Action**, and a **From** and **To** date. The person filter matches someone as either the actor or the target. Open a row to see its full details.

## Accounts

**Site users** lists every account. Admins can sign in as another person for support and testing. This tab and **Payroll** are only visible to admins.

**Security** lists blocked addresses and trusted networks for sign-in. Core can read the rules, and only admins can change them.

## Other sections

- **Payroll** (admins only): **Hire setup** builds the term's payroll export, and **Reconcile** compares TimesheetX hours to staffing.
- **Rooms**: bookable rooms and the iPad displays outside them.
- **Onboarding**: author and run time-boxed onboarding activities, like the scavenger hunt.

## Who can do what

Core and Admin can both open Admin, edit jobs and feature flags, and retry messages in the outbox. Only admins can use Payroll and Site users, change Security rules and shared inbox categories, change lab access and create or delete domains in [Roles & domains](/core/access).
