---
title: Tasks and the project board
summary: Create and update project tasks on the board, plan with epics, stories and sprints, link a GitHub issue, archive finished work, and see your own tasks on My Tasks.
paths: [/projects/:id, /notifications]
keywords: [task, board, kanban, status, checklist, subtask, comment, epic, story, user story, sprint, timeline, archive, github, issue, deadline, assignee, blocked, my tasks, backlog]
---

Each project has a task board and a plan above it, both on the **Progress** tab of the project page. Tasks are the work, stories and epics group the work, and sprints are the weeks it lands in. Your own assigned tasks from every project are collected on [My Tasks](/notifications).

## Who can change tasks

Core and anyone staffed on the project, in any term, can create, move, edit and comment on tasks. Everyone else can open the project and read tasks but not change them. The board and the task window simply hide the buttons they cannot use.

## The board

Open a project from [Projects](/projects). The board is on the **Progress** tab, under the timeline. Columns run Backlog, To do, In progress, In review, Done and Cancelled.

- Drag a card to another column to change its status. Drag within a column to reorder.
- Each card shows its deadline, a **Blocked** chip if it waits on unfinished tasks, and counts for checklist items, comments, files and a linked GitHub issue. A dot means it changed since you last opened it. A deadline that has passed is marked overdue.
- Search with the box at the top. The people filter next to it limits the board to certain assignees.
- **Customize** opens filters for sprint, term and epic, plus **Hide empty Backlog / Cancelled**. The board opens on the current term. Pick a different term to see older work, and the sprint filter becomes available once a term is chosen.
- Each column's three-dot menu has **Add task** and **Collapse column**.

## Create a task

Click **Add new task** at the top of a column, or use **New** then **Task** on the timeline. A **New task** window opens. A title is required, and so is a deadline unless the task starts in Backlog. You can also set:

- **Description**, where Markdown works.
- **Status**, **Starts** and **Deadline**.
- **Assignees**. You can pick from the project's team for the current term, or the most recently staffed term if the current one has nobody.
- **Domain**.
- **Epic** and **User story**. Pick the epic first, then one of its stories.
- **Blocked by**: tasks that must finish first.
- **Create GitHub issue**, when the project has repositories listed.

Click **Create task**. Checklists, comments and files come after the task exists.

## Edit a task

Click a card to open it. It opens read-only. Click the pencil (**Edit task**) to change it, then **Save**. **Delete** removes the task and its checklist for good, so use **Cancelled** if you only want it off the plan.

Inside an open task:

- **Checklist**: type an item and press Enter. Tick items off as you go. A card shows how many are done. A task holds up to 100 items.
- **Work files**: **Upload files** to add new files to the project, or **Attach existing** to link a file that is already in the project's Drive. **Unlink** detaches a file without deleting it. See [Project files and sharing](/help/articles/project-files).
- **Comments**: write a comment and use @ to mention someone, then click **Comment**. Mentioned and assigned people are notified.

## Link a GitHub issue

If a repository is listed under the project's **Repositories** on **Project details**, a task shows a **GitHub** section. Click **Add GitHub issue**, pick the repository, then either **Create new issue** or enter an existing issue number and click **Link**. **Unlink** removes the connection.

Linked issues stay in step with the task: closing the issue on GitHub moves the task to Done (or Cancelled if closed as not planned), and reopening it moves the task back to In progress. Assignees and comments also sync.

## Epics, stories and sprints

The timeline at the top of **Progress** is the plan.

- An **epic** is a large piece of work with a status (Backlog, Open, In progress, Done or Cancelled), start and end dates, a description and dependencies on other epics.
- A **user story** sits inside an epic and has its own status (Not started, In progress or Done), dates and dependencies. Tasks attach to stories.
- A **sprint** is a week, numbered from the start of the term (Sprint 1, Sprint 2 and so on). You do not create sprints. A task or epic falls into the sprints its dates cover, and a task with no dates is unscheduled.

Click **New** on the timeline toolbar to add a **Task**, **User story**, **Epic** or **Meeting**. Click an epic bar to open it, where you can edit dates, status, the description and add stories by typing a name and pressing Enter. Switch between the timeline and an outline with the **Timeline view** and **List view** buttons.

## Archive finished tasks

Done and Cancelled tasks leave the board when archived. Open **Board actions** (the three dots at the top right of the board) and choose **Archive Done & Cancelled** to do it now, or **View archived tasks** to look back. Archived tasks are hidden, not deleted. Idle Done and Cancelled tasks are also archived weekly, by default after 7 days with no activity.

## My Tasks

[My Tasks](/notifications) is in the sidebar. The **Project work** tab lists open tasks assigned to you (To do, In progress or In review) across all projects, soonest deadline first. Each card says whether it is overdue, is In progress with no updates for two weeks, is in review, or has no due date. Click one to open it on its project board, or use **Mark done** on the card. The **General** tab holds meeting RSVPs, mentions and other things that need you, and **History** shows what you have already handled.
