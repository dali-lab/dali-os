---
title: Running staffing
summary: For Core and Admins, how to set up the term's forms, place members on the staffing board, review level ups, finalize projects and issue term agreements.
audience: [core, admin]
paths: [/core/staffing, /core/intent-to-work, /core/project-bids, /core/level-up, /projects/staffing, /projects/intent-to-work, /projects/project-bids, /projects/level-up]
keywords: [staffing board, finalize, finalize all, intent to work, project bids, level up, term agreements, domain eligibility, unassigned, term channel, external mentor]
---

Staffing is the term-by-term process that places members on projects. Core members and Admins run it from four pages under Core: **Staffing**, **Intent to Work**, **Project Bids** and **Level Up**. Members never see these pages. They only fill out forms. See [How staffing works](/help/articles/staffing) for the member side.

Each term has its own staffing round, created the first time someone opens one of these pages for that term. Every page has a term picker, so you can look at earlier terms too.

## Set up the forms

Intent to Work, Project Bids and Level Up each read from a form you connect for the term.

1. Open the page, for example [Intent to Work](/core/intent-to-work), and choose **Advanced settings** (it says **View settings** if you can't change them).
2. Under the form field, pick a form and choose **Save**. If another term already uses that form, you are asked to confirm moving it.
3. Turn on **Open for submissions**. Until you do, members can't fill the form.
4. Use **Send to members** to open the Announcements composer with the form attached. Connecting a form does not tell anyone.
5. Map the form's questions to columns and choose **Save columns**. The roles that matter are:
   - Intent to Work: a **Status** question for each term you care about, with each answer mapped to Returning, Off this term, Graduating, On leave or Unsure.
   - Project Bids: three **Project** picks, in order, plus **Submitted by** and **Hired roles**. The mapping is not complete until all three picks and both of those are placed.
   - Level Up: **Applying In** (the domain) and **Applying For** (the level), which enable the Level Up button, plus **Submitted by**.
   - Anything else can be a view-only column.
6. Optionally use **Lock the app** to require an audience to fill the form before they can use the rest of the app. The choices are everyone active this term, returning members, new members or mentors. A member fills a locked form once.

A banner on a page warns you if the mapping has a problem. Submissions are still recorded, but the affected columns won't feed staffing until you fix it. The Staffing board shows a warning when no Project Bids form is connected.

## Review submissions

Each of the three pages is a table of submissions for the term. You can search by name or email, and filter by term, domain and any column. Choose a member's name to see their full submission.

- Intent to Work tells you who is returning, off, graduating, on leave or unsure.
- Project Bids shows each member's ranked picks. Bids appear on the board as the member's top choices.
- Level Up shows who is asking to move up, and in which domain.

## Review a level up

On [Level Up](/core/level-up), a row with a target domain and level has a **Level Up** button, labeled with the target such as **Level Up → P2**. Choose it, then confirm in **Confirm Level Up**. This sets the member's level in that domain. A row that is already at the target shows **Promoted** instead. A row with no mapped target shows a dash. Only Core and Admins can do this.

## Place people on the board

[Staffing](/core/staffing) is a board with one column per project, plus an **Unassigned** column on the left for people who are not placed yet. Drag a member card between columns to place or move them. Edits show up live for other Core members viewing the same term.

- Choose a card to open the member's bid. In the bid you can press **Place here** next to a project. A card that says **Bid unresolved** means none of their picks matched an open role, so place them yourself.
- On a card, change a domain's level with the level chip, or add another domain with the add control. These set the member's domain level, which is the highest level they can be staffed at in that domain.
- On a card in a project column, the Mentor or Mentee badge sets how that person is paired for mentorship. It defaults to mentor at P3.
- **Add member** puts someone who did not bid onto the board, in Unassigned. It can also add an external mentor to a project with **Add as external mentor**, choosing the project and domain, then **Add mentor**.
- Use the search box and the domain picker to narrow the board.
- Press the remove control on a card to take a member off a project or off the board. You are asked to confirm.

Placements on the board are proposed until you finalize.

## Finalize staffing

Finalizing locks in a project's roster. Each project column has a finalize check icon in its header. Hover it to see the state: not finalized, finalized, or a count of changes made since the last finalize. A banner above the board lists projects with unfinalized changes.

1. Choose the icon to open **Finalize** for the project.
2. Pick the steps to run:
   - **Propagate assignments** confirms proposed placements. Members are notified, and any promotions are noted for Admins.
   - **Post roster to Slack**, with a channel name.
   - **Set up GitHub teams**, with a team name.
   - **Create team email group**.
3. Choose **Finalize** and confirm. It is safe to run again, for example if a placement changes later.

The Slack, GitHub and email steps only run in production. On staging they are skipped. If a mentor on the project is not yet P3, the modal offers to promote them first, and you can uncheck that.

To do every project at once, choose **Finalize all** at the top of the board. It defaults to propagating assignments only, and you opt in to Slack, GitHub and email for the run.

## Term Slack channel and agreements

Two banners on the board come after placement:

- **Term Slack channel**: enter a channel name and choose **Create + invite**. This creates the channel on Slack and invites all Core, Admins and everyone staffed on a project this term.
- **Term agreements**: choose **Issue agreements**. It shows what will be sent and to whom, then **Send** puts the term's recurring agreements in force and sends sign requests to the staffed roster. Finalize staffing first, because only staffed people are included. Running it again only reminds people who haven't signed.

## Domain eligibility

A member's domain level is changed on their board card (see above) or from the Level Up page. Changing a level on a card also updates their proposed placement in that domain, so the level that gets confirmed matches.
