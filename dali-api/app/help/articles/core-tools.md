---
title: Core tools
summary: Set roles and domains, send announcements, edit email templates, manage the listserv queue, and check the outbox of emails and Slack messages.
audience: [core, admin]
paths: [/core, /core/access, /core/communications/announcements, /core/communications/email, /core/communications/listserv, /admin/messaging/outbox]
keywords: [core, roles, domains, admin access, staff, core title, domain lead, announcement, email template, listserv, outbox, retry, failed email, level, P1, P2, P3]
---

The Core area holds the tools Core members use to run the lab. It appears in the sidebar for Core and Admin. Everyone else who opens a Core page lands on the home page. This article covers roles and domains, communications, and the outbox. Staffing, Intent to Work, Project Bids, Level Up, Agreements, Partners and Drive folders have their own tabs in the same area.

## Roles and domains

Open **Roles & domains** at [/core/access](/core/access) to see who can do what.

- The domain cards at the top show each domain, its lead and how many people are in it. Select a card to filter the table to that domain. The filters above the table are **Everyone**, **Admin & staff**, **Core** and **Domain leads**.
- Search by name, email or Core title.
- Select a person to open their panel. Changes save as you make them.

In a person's panel you can:

- **Core**: add a Core title, or leave it empty for plain Core. Core lasts the whole Core cycle. Adding a title tells admins, since it affects pay. Remove a title with its small x.
- **Domains**: set the person's level in each domain, from **P1 · Learner** to **P2 · Doer** to **P3 · Mentor**, or choose **Remove from domain**. The level decides staffing and notifies them.
- **Lead**: check **Lead** next to a domain to make them that domain's lead for the current term. Leads from other terms are listed so you can remove them.

**Lab access** (Member, Staff or Admin) can only be changed by an admin. Staff get admin access and are exempt from the student checklist. Admin gives everything in Admin, including payroll and platform settings. Admins listed in the server's admin list can't be changed here. Only admins can create or delete domains with **Manage domains**, and a domain can be deleted only when nothing uses it.

## Announcements

Open [Announcements](/core/communications/announcements) under **Communications**. Announcements reach members in the app and by email. Members who turned on Slack DMs for announcements get one there too. The page lists **Scheduled** and **Sent** announcements. For sent ones it shows how many recipients have seen it, or done it when it has a due date.

To send one, select **New announcement**:

1. Add a title and a body. Formatting and links carry through to the email.
2. Under **Send to**, choose **Whole lab**, or add groups and people.
3. Optionally attach a published form. It shows up in recipients' Tasks until they fill it in. You can also set a due date.
4. Turn on **Schedule for later** and pick a time to send at a future date, or leave it off to send right away.
5. Turn on **Also CC their Dartmouth email** if you want a copy sent to each person's Dartmouth address.
6. Select **Send now** or **Schedule**. A sent announcement can't be taken back.

A scheduled announcement can be canceled with **Cancel send** on its row before it goes out.

## Email templates

[Email templates](/core/communications/email) holds the wording of every email the app sends, such as hiring decisions and course notices. Pick an email from the list, edit the subject and body, and use the **Insert** buttons to add values like a person's name. A preview with sample values shows how it will look. Select **Send test** to email a copy to yourself, then **Save**. Every send uses the new wording from then on.

Past saves are kept under version history, and you can restore any of them. Leaving both subject and body empty turns that email off. A warning marker means an email has no wording yet, and releasing is blocked until it has some.

## Listserv

[Listserv](/core/communications/listserv) is a queue for campus listserv emails. Anyone on Core can select **Submit an email**. The outreach lead reviews each submission and approves it or requests changes. Approved emails move to **Ready to send**. The lead sends them from the listserv address in Gmail (use **Copy email**) and then selects **Mark as sent**. Only an admin can change who the outreach lead is.

## Check the outbox

Every email and Slack message the app sends goes through the outbox. Open **Outbox** under Admin, Messaging at [/admin/messaging/outbox](/admin/messaging/outbox). Filter by status (**Pending**, **Sending**, **Sent**, **Failed**, **Canceled**) or search by recipient, event or subject. Open a message to see its details.

- **Retry** sends a failed message again. **Retry all failed** does this for every failed message that matches your search.
- **Cancel send** stops a pending or failed message.

Core and Admin can both do this. Use it when someone says they never got an email.
