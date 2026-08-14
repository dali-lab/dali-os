# Projects Hub — Guide content draft

Draft content for the **`projects.hub`** page guide (the "Guide" button on `/projects`).
Each `##` heading below is one **section** in the guide editor (left-sidebar nav). Paste the
body under each into the section's rich-text editor. Every section also has an optional
walkthrough-video slot — I've marked good candidates with _[video]_.

> Scope note: `/projects/:id` (the project workspace with its tabs) has no Guide button of its
> own today. This single hub guide covers the whole area. If you'd rather split it, we can add a
> `docKey` to `projects.$id.tsx` and move the tab sections into a dedicated workspace guide.

---

## Welcome to Projects

Projects is where the lab's work actually happens. Each project has its own **workspace** — a
single place for the team's tasks, roadmap, documents, files, and the people staffed on it.

This page, the **Projects hub**, lists every project you can see. Open one to land in its
workspace, which is organized into a few tabs:

- **Overview** — the project at a glance: description, scope, team, partners, links, docs, and files.
- **Board** — the task board for day-to-day work.
- **Planning** — epics and sprints, on a timeline.
- **Mentorship** — weekly mentor notes (visible to mentors and Core only).

You don't need to set anything up to start — every active project already has a workspace. Read on
for what each part does.

## Finding a project on the hub _[video]_

The hub lists projects with their icon, name, status, and the term(s) they run in.

- **Open a project** by clicking its card — that takes you into its workspace.
- **Filter by term** to see just the projects running in a given term.
- **Filter by showcase status** to find projects by how far along their public write-up is
  (Not written up → In progress → Needs review → Published). Handy at end-of-term when we're
  publishing project pages to the DALI website.
- **Status** on each project is one of **Active**, **Paused**, or **Archived**. Archived projects
  stay searchable but are out of the way.

If you're staffed on a project, it'll show up here for you. Staffing itself (who's on what) lives
under the **Staffing** pill — that has its own guide.

## Overview tab

The Overview is the front page of a project. Depending on your role you'll see some or all of:

- **Description** — a short blurb on what the project is. Editable by the team.
- **Challenge / Scope** — the per-domain, per-term scope statement (what Design, Dev, etc. are
  tackling this term). Read-only here; Core edits it in **Settings**.
- **Partners** — the partner org(s) sponsoring the project, with contacts and active dates.
- **Details** — the project's working links and identifiers: repository URLs, deployment URL,
  GitHub team, Slack channel, and team calendar. Keep these current — other parts of the app and
  the partner view read from them.
- **Team** — the roster, grouped by term, with each member's domain and level. Core can see
  eligibility ceilings and mentee counts, and adjust levels inline.
- **Meetings** — the project's next few scheduled meetings (read-only; create and reschedule these
  in **Calendar**).
- **Documents** and **Files** — collaborative docs and uploaded work files (see the next section).
- **Recent activity** — a running log of notable changes (new files, visibility flips, showcase
  status, partner changes). Visible to people who can edit the project.

## Documents & Files

Two related but distinct things live on a project:

**Documents** are collaborative pages (like Notion/Docs) that live inside the project. They support
folders (one level of nesting), pinning, and real-time co-editing.

- **Add a document or folder** from the Overview. It opens alongside the workspace so you can keep
  the project in view.
- **Pin** the docs the team reaches for most — pinned docs float to the top.
- Every project has auto-created **Team** and **Partner** meeting-notes folders.
- **Visibility toggles** control whether a doc is visible to partners (on the partner portal) or
  published publicly. Default is internal-only.

**Files** are uploaded work artifacts (designs, exports, builds) with **version history** — upload a
new version and the old ones stay available. Files can be linked to tasks, and the Overview groups
them by the epic they belong to. Each file has its own **partner-visible** toggle.

## Board tab — tasks _[video]_

The Board is a kanban board for the project's tasks, with columns for **Backlog → Todo →
In progress → In review → Done** (plus **Cancelled**). Drag cards between columns, or reorder within
a column.

Each **task** can carry:

- **Priority** (Low / Normal / High / Urgent) and a **due date**
- **Assignees** — one or more members (they get notified when assigned)
- **Domain** label, and which **epic** and **sprint** it belongs to
- A **checklist** of subtasks
- **Linked files** (artifacts) and a **GitHub issue** — link an existing issue or create a new one
  from the task; status, assignees, and details stay in sync
- **Comments** — assignees and Core can discuss on the card; others on the task get notified

Filter the board by **epic**, **sprint**, or **term** to focus. Anyone staffed on the project (and
Core) can create and edit tasks.

## Planning tab — epics & sprints _[video]_

Planning is the project's roadmap. It has two views:

- **Timeline** (default) — a Gantt-style chart of epics with their sprints nested underneath,
  color-coded by status. Drag to reschedule, and draw **dependencies** between sprints (one waits on
  another) as arrows.
- **List** — a flat, quickly-editable list of epics and sprints with inline status, dates, and
  reordering.

**Epics** are the big buckets of work — each has a status, an optional date span, a target term, a
progress count (done / total tasks), and can hold **stories** (with notes, acceptance criteria, and
success metrics). Give an epic a rich description document if you want more room to write.

**Sprints** are time-boxed containers of work (**Planned / Active / Closed**) that can sit under an
epic or stand alone. A sprint's term is derived from its start date.

Tasks reference their epic and sprint, so the Board and Planning stay in step.

## Mentorship tab

If you're a mentor on the project (or Core), you'll see a **Mentorship** tab for tracking weekly
mentor notes and the mentor↔mentee pairs on the project. It's hidden from everyone else — mentees
don't see notes written about them here. Templates and the broader mentorship flow live in the
**Mentorship** area.

## Sharing: partners & showcase

Two views control what people outside the team see.

- **Partner view** (`/projects/:id/partner-view`) is a read-only preview of exactly what the
  project's partner org sees on their portal — only the docs, files, and details you've marked
  partner-visible, plus the team and active partnership dates. Use it to sanity-check before sharing.
- **Public / showcase view** (`/projects/:id/public-view`) is the marketing card for the DALI
  website: display name, tagline, year, tags (products, sectors, tech), links, a hero image, and a
  write-up. It moves through **Not started → In progress → Needs review → Published → Archived**.
  Anyone on the team can edit the content; **only Core publishes**. Published cards go live on the
  website.

## Settings & who can do what

The **gear** icon opens project settings — declared **domains**, the project's **terms**, and the
**scope grid** (the per-domain, per-term challenge text). These are **Core-only** to edit; staffing
leads can view them.

Quick guide to permissions:

- **Anyone staffed on the project (and Core)** can edit the Overview details, and create/edit tasks,
  epics, sprints, documents, and files.
- **Core only**: domains, terms, scope, accounting/chart string, partner links, level adjustments,
  publishing the showcase, and deleting the project.
- **Mentors (and Core)**: the Mentorship tab.
- **Task comments**: the task's assignees and Core.

If something's read-only for you, that's the permission model doing its job — ask a lead if you need
a change made.
