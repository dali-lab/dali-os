# Project Hubs — Complete Review (July 20, 2026)

Audit of `/projects` (area hub) and `/projects/:id` (per-project workspace) ahead of the team demo. Four passes: feature inventory, task system, integrations, and a role-based first-time-user walkthrough. All paths relative to `dali-api/`. Two highest-stakes findings were independently re-verified in code.

---

## 1. Pre-demo checklist (do these before the demo)

1. **Seed check: every demo project needs a current-term `ProjectTerm` row.** The hub defaults to the current-term filter and shows only Active projects with that term (`app/projects/routes/projects.hub.tsx:62-65`). Projects without it render as **"No projects yet."** with no explanation. Either fix the data or open the demo on "All terms".
2. **Present from a Core account.** There is no PM tier on the project page — levels editor, settings gear, partner link/unlink, payroll are all Core-gated (`projects.$id.tsx:317, 320, 691`). A non-Core PM sees exactly the developer view. Any "as the PM you can…" line is false otherwise.
3. **Do not delete an epic that has user stories** — it 500s (verified bug, §2.1).
4. **One driver on the task board.** The board never picks up server changes after mount (verified, §2.2). Two people on the same board silently diverge; reload to resync.
5. **Rehearse the board at demo resolution.** Five fixed `w-64` columns ≈ 1,350px next to the 256px sidebar (`app/components/board/KanbanBoard.tsx:127, 199-201`) — at 1440×900 the Done column is off-screen, so the drag-to-Done payoff needs a horizontal scroll. Consider collapsing the sidebar.
6. **Stay away from the header status select while screen-sharing.** Any project member can flip a project to Archived with no confirmation (`projects.$id.tsx:1210-1221`), which drops it from the default hub view and cuts partner-portal access (`:619-622`).

---

## 2. Verified bugs

### 2.1 Deleting an epic with user stories returns a 500
`api.epics.$id.ts:63-68` unlinks sprints and tasks in the delete transaction but never touches `UserStory`, whose FK is `ON DELETE RESTRICT` (`prisma/migrations/20260515161947_epic_description_and_user_stories/migration.sql:25`). The confirm dialog even promises "Its sprints, stories and tasks will be unlinked, not deleted" (`EpicSprintManager.tsx:702-706`). The MCP `delete_epic` tool does it correctly (`app/mcp/tools/delete-epic.ts:51` runs `userStory.deleteMany` first) — the web route is missing that one line. **Repro: create epic → add a story → delete epic → error.**

### 2.2 The board never reflects anyone else's changes
`TaskBoard.tsx:58` sets `adoptServerItems: false` — deliberate (the comment explains it protects optimistic state from parent revalidations), but the consequence is that teammate edits, GitHub webhook status flips, sprint rollovers, and even your own task's new GitHub issue link never appear until a full page reload. This is the single biggest daily-driver problem for a team using it as their board.

---

## 3. What's actually there (inventory)

### /projects hub
Search (name + partner name), term filter (defaults to current term, Active-only), list/card toggle persisted per-user, Core-only "+ New project" inline form (name, blurb, status, start term, partner; auto-derives GitHub team slug and creates the project Group). Pills: Hub for everyone; Board / Intent to Work / Project Bids / Level Up are Core-only; My Staffing for everyone.

### /projects/:id workspace
- **Header**: banner image (crop + upload, gradient fallback), inline name/status edit, domain chips, term summary, live presence bar, "Partner view" button.
- **Overview tab**: Markdown description; current-term per-domain Challenge (read-only); Partners (Core can link/unlink); Project details (calendar email, team email group, GitHub team, Slack channel, terms planned, repo URLs, deployment URL, Core-only payroll chart string); Team grouped by term with Core-only P1/P2/P3 level select (eligibility- and mentee-guarded); Documents (2-level page tree, two system meeting-notes folders, split-screen editor tabs, per-doc partner-share toggle); Files (S3 uploads with version history, detail page has tags + comments).
- **Work tab**: Epics & sprints manager (epic CRUD with collab-doc descriptions, user stories, sprints inside epics, drag-reorder, status filter) + read-only Gantt timeline + task board (5 fixed columns, multi-assignee, priority, due date with overdue highlight, domain chip, `?task=` deep links, optional GitHub issue creation).
- **Mentorship tab** (mentors/Core only): derived pairings + recent mentor notes, links to browse.
- **Partner view**: exact same component the partner portal renders — hero, current work with sprint progress, recently completed, shared docs, roster (names + domains only).
- **Settings gear** (Core): domains, term set, per-domain-per-term challenge grid.

### Automation already live (worth saying in the demo — easy to undersell)
- **Task due reminders**: 24h-before + at-deadline, idempotent ledger (`app/jobs/task-due-reminders.server.ts`).
- **Sprint lifecycle job**: auto-closes past-due Active sprints, rolls unfinished tasks to the next Planned sprint or backlog, posts a summary to the project Slack channel (`app/jobs/sprint-lifecycle.server.ts`).
- **Standup prompts** to every Active project's Slack channel on weekday mornings.
- **Two-way GitHub sync**: check a task Done → issue closes with labels; close/comment/assign on GitHub → task status, comments, and notifications update here.
- **MCP surface**: `list_my_projects`, `get_project_overview`, board/backlog resources, full task/sprint/epic write tools, and the `project-status` prompt that drafts a status update from a project-name fragment. Claude genuinely reads and writes the hub — strongest wow moment available.

---

## 4. Confusing — "I expected X, got Y" (demo-audience ranked)

1. **Tasks are disconnected from sprints/epics in the web UI.** The create modal has no sprint/epic field, create never sends them, and PATCH doesn't accept them (`TaskBoard.tsx:142-148`, `api.tasks.$id.ts:19-31`) — sprint membership is currently MCP/mobile-only. Meanwhile sprint-delete copy promises "tasks move back to the backlog" (`EpicSprintManager.tsx:978-983`) — a backlog the board can't show. Epics/sprints and the board read as two features standing next to each other, not one workflow.
2. **Task comment notifications open a modal that renders no comments.** GitHub comments are mirrored into `TaskComment` and `task.comment` notifications fire — but `TaskModal` displays none of it. Users get notified about content the web product cannot show.
3. **No task delete anywhere** — only drag to Cancelled, which accumulates forever (`api.tasks.$id.ts` is PATCH-only; MCP has `delete_task`).
4. **Board drag quirks**: drag works only from the grip handle, not the card body; same-column drags (prioritizing within To do — the first thing a Trello user tries) silently snap back (`TaskBoard.tsx:123, 290-297`).
5. **Task modal discards edits on close** (X/backdrop/Escape, no dirty guard), and edit-save failures surface as a board banner *after* the modal already closed — reads as "it saved" (`TaskModal.tsx:119-126`, `TaskBoard.tsx:86-110`).
6. **Silent completion.** Drag to Done: no toast, no animation, no notification. Nothing anywhere in the app confirms mutations succeeded — the universal pattern is silent revalidate.
7. **In-app changes don't notify, GitHub-originated ones do.** Task create, status moves, and all sprint/epic/story mutations dispatch zero notifications; the same status flip arriving via webhook notifies (`api.tasks.$id.move.ts` vs `api.webhooks.github.ts:101-116`).
8. **Partner "Unlink" hard-deletes the partnership record** (confirm says so), while a softer end-partnership action and start/end dates exist server-side and are never rendered — ended partnerships look identical to active ones (`projects.$id.tsx:749-755, 2334-2355`).
9. **`?tab=mentorship` as a non-mentor renders a blank page body** — the tab validates but neither branch renders (`projects.$id.tsx:101-103, 1025-1027`).
10. **Everything is open**: any member can open any project, read its documents, and — if ever staffed on it, any term — edit everything including rename/archive. The Notion crowd's first question ("who can see this?") should be answered proactively: everyone in the lab, by design.
11. Smaller but real: action errors render only on the Overview tab (`:2107-2111`); level-editor errors are a bare "!" with hover-only text (`:2059-2063`); clicking an epic lands in the edit form, not a read view (`EpicSprintManager.tsx:140-148`); timeline bars can be a day off from listed dates (UTC vs local, `EpicsTimeline.tsx:92-96`); doc/file "Delete" actually soft-archives with no restore UI; folder creation is a `window.prompt`; hub table rows are onClick handlers so cmd-click can't open a new tab (`projects.hub.tsx:353-359`); the "Current" team badge marks the newest term with assignments even if it's long past (`:1962-1970`); Markdown renders internally but prints raw asterisks in the partner view (`PartnerProjectHubView.tsx:159-163`); no way to remove a banner image; tab switches use `replace: true` so Back exits the project rather than stepping tabs.

---

## 5. Missing — "I expect this to do this"

**Team's first-week asks (Linear/Trello lens):**
- **My Tasks** — no web view or Home widget queries `TaskAssignee`; exists only as MCP `list_my_tasks`. Home has zero project presence at all (`app/routes/home.tsx:64-103`).
- **Board search/filtering** — no filter by text, assignee, priority, domain, sprint, or epic; no sprint scoping, so Done shows every task ever.
- **⌘K** doesn't index tasks or files, and matches projects on name only (`app/lib/search.server.ts:103-110`).
- **Subtasks/checklists** — `Task.checklist` exists in schema, MCP `set_task_checklist` fully implements it, modal shows nothing.
- Bulk actions, labels beyond the single domain chip, task history (only "Created by X"), keyboard shortcuts, assignee avatars on cards: none. (Estimates/points absent by documented v1 decision.)

**Hub level:**
- **No team management from the project page** — no add/remove member, no pointer to Staffing. "How do I add someone?" has no answer on the page.
- No "my projects" filter, sort controls, status filter, favorites, or recently-viewed on the hub; no archive/delete flow or archived-projects view beyond "All terms".
- No activity feed — audit events are written for doc/file/level/partner mutations but never rendered.
- **Meetings**: `ScheduledMeeting.projectId` exists and the calendar can file meetings under a project, but the hub never shows its meetings.
- Files: rename exists in the API with no button; no inline preview; tags exist with no filter; no partner file sharing. Docs: no rename/move/reorder from the list (rename only inside the editor).

---

## 6. "Whoa, that would be cool" — ranked by leverage (backend mostly exists)

1. **Task comments UI** — render `TaskComment` in the modal + one POST route lifted from `app/mcp/tools/add-task-comment.ts` (permissions and notify logic already written). Instantly makes GitHub comment mirroring visible and fixes §4.2.
2. **Sprint picker on tasks + a backlog/sprint-scoped board view** — `sprintId` is already shipped to the client (`app/projects/lib/task-board.ts:37-38`); PATCH needs two keys (MCP `update_task` has the exact validation). This is what makes the sprint-lifecycle job's rollover legible and unifies the Work tab.
3. **Checklist UI in the modal** — port the MCP normalization; near-free subtasks.
4. **Live board** — re-enable server adoption or reuse the desktop SSE work; unlocks the entire existing webhook/notification machinery appearing in real time (fixes §2.2).
5. **My Tasks page / Home widget** — reuse the `list-my-tasks` query; pairs with the due-reminder job already running.
6. **Sprint auto-activation** — the lifecycle job closes sprints but nothing flips Planned→Active at `startsAt`; ~5 lines in the same handler.
7. **Tasks (and files) in ⌘K** — one more entry in `search.server.ts`, membership-scoped like hiring results.
8. **Epic progress** — done/total counts per epic on the row and timeline tooltip; data already in the loader.
9. **Activity feed from AuditEvent** — read-only "Recent activity" section is mostly a query.
10. **Partnership dates + "End partnership"** — server handler and loader data both exist; closes the destructive-unlink gap.
11. **Deep links**: Slack channel as a real link (plain text today), Overview/PRD pinned rows atop Documents (`overviewPageId`/`prdPageId` are loaded and never rendered).
12. **Upcoming meetings widget** on Overview from `ScheduledMeeting.projectId`.
13. Small polish: notify on doc-shared-with-partner and status change; Markdown in partner view; remove-image option; "Active this term" indicator (already computed, never displayed); surface future-term challenges to members.

---

## 7. Suggested demo beats (plays to verified strengths)

1. Hub → open a project → banner, description, team, docs with split-screen collab editing and presence.
2. Create a task with "Create GitHub issue" → drag to Done → show the issue auto-closing on GitHub; then comment on GitHub and show the notification arrive (skip opening the modal for the comment — see §4.2).
3. Flip a doc partner-visible → "Partner view" button → exactly what the partner org sees (same component, different auth).
4. Tell, don't show: due-date reminders, sprint auto-close with Slack summaries, morning standup prompts.
5. Finale: MCP — ask Claude for a project status update via the `project-status` prompt, or have it plan a sprint from the backlog resource.
