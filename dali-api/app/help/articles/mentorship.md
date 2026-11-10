---
title: Mentorship
summary: Write weekly mentor notes, see mentees and the lab-wide notes grid, manage note templates, and remind mentors who are behind.
audience: [mentor, core]
keywords: [mentor, mentee, notes, weekly notes, vibe check, template, nudge, reminder, pairing, pairs]
paths: [/mentorship, /mentorship/browse, /mentorship/notes/:id]
---

Mentorship is where mentors keep a short weekly note on each mentee. Mentors and Core can open it. Mentees can't see the Mentorship pages or their own mentor's notes.

## Who counts as a mentor

You see **Mentorship** under **Lab** in the sidebar if you are Core, or if this term you are a P3 on a project, a domain lead, or a PM mentor (a P3 in the PM domain with a role this term). Anyone else who opens the page gets a "Forbidden" error. Alumni never see it.

## Your mentees

Open [Mentorship](/mentorship). The page shows **My mentees** for the current term as a grid: one row per mentee, one circle per week of the term.

- A colored circle is a week with a note. The color is the vibe check (see below). Hover a circle to see the vibe.
- A plain ring is a week with no note. Between terms the grid previews the upcoming term, and the page says when notes resume.
- Click a week to open that week's note, or to create it if it doesn't exist yet. One note exists per mentor, mentee and week.
- Core also sees a form icon per mentee, the Week 5 check-in. Each half fills in when the mentor or the mentee has submitted it. Core sets which forms are linked.

If you have no pairings, the page says you aren't currently paired with any mentees this term. Pairings are created when staffing is finalized. Only Core can reassign or remove a pairing.

## Write a note

A note opens in a panel, or on its own page at a link like `/mentorship/notes/...`. Notes are written in the same editor as documents and save as you type, with a "Saving..." then "Saved" indicator.

1. Pick a **Vibe check**. This is required: **Excellent**, **Room for improvement** or **Concerning**. Mentors and Core can see it. The mentee can't.
2. Write the note. The prompt reads "What went well, what's blocked, what to follow up on...".

Only the note's author and Core can edit it. Any other lab mentor opens it read only, and the vibe buttons are disabled.

New notes start from the default note template, if Core has set one.

## Browse notes lab-wide

On the Mentorship page, click **Weekly notes from every mentor in the lab**, or the arrow beside the notice that replaces it between terms or when Core is shown missing notes. You can also go straight to [Mentorship notes](/mentorship/browse). Every mentor and Core can read every note here.

- Pick a term with the term filter at the top right. It starts on the current term.
- Search by mentor or mentee name.
- Use the filter bar to narrow by **Project**, **Domain** or **Status**. Status is the vibe (**Excellent**, **Room for improvement**, **Concerning**) or **Not filled in**.
- Mentors are shown as collapsible cards, each with a row per mentee.
- From a member's profile, the **Mentorship** tab has a **View notes** button that opens this page filtered to that mentee.

## What Core can do

These controls on [Mentorship notes](/mentorship/browse) are for Core only.

### Templates

Click **Templates** to open **Note templates**. Every new mentor note starts from a template, and the default is applied automatically.

- Create a template, give it a name and write the sections and prompts mentors should fill in each week.
- The first template you create becomes the default. Click **Make default** on another to switch.
- You can also rename or delete a template from the same window.

### Remind mentors who are behind

On [Mentorship](/mentorship), Core sees how many mentors are missing a note this week while a term is running.

On the notes page, click **Message unfilled** to open **Message mentors who haven't filled in**. It lists each mentor with unfilled notes.

1. Edit the **Message** if you want. The default is "This is a reminder to fill in your weekly mentorship notes."
2. Check the recipients.
3. Click **Send reminders**.

Each mentor gets a Slack DM and an in-app notification listing exactly which mentees and weeks are missing. Slack messages only go out on the live site. On other environments you'll see a note that nothing was sent. A mentor without a linked Slack account is skipped, and you'll be told.

Core can also send one mentor a reminder with the **Nudge** button on their card. It shows only for mentors with unfilled notes.

### Link forms

**Link forms** connects a form to each domain for the term, so the form icons in the grid show who has responded. Pick a term first.

### Fix a pairing

Core can review and change who mentors whom under **Review pairings** when finalizing a project's staffing. Mentors and Core can also see a project's pairings on that project's **Mentorship** tab.
