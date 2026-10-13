// MCP prompt `sprint-planning` — drafts the next sprint for a project from the
// sprint list, board, backlog and epics.

import type { PromptDefinition } from "./types";

export const SPRINT_PLANNING_PROMPT: PromptDefinition = {
  name: "sprint-planning",
  description:
    "Draft a candidate next sprint for a project: pick ranked tasks from the backlog, account for carry-over, balance assignees, suggest a goal.",
  arguments: [
    {
      name: "projectId",
      description: "Project.id (as returned by list_my_projects).",
      required: true,
    },
  ],
  build(args) {
    const projectId = args.projectId;
    return [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Plan the next sprint for project ${projectId}. Use the dalios MCP tools:`,
            "",
            `1. Call \`list_sprints\` with projectId="${projectId}" and pick the next upcoming sprint (sprints are fixed weekly windows starting on the team's anchor day).`,
            `2. Read resource \`dali://projects/${projectId}/board\` for what is already in that sprint and what is carrying over.`,
            `3. Read resource \`dali://projects/${projectId}/backlog\` for ranked unscheduled work.`,
            `4. Call \`list_epics\` with projectId="${projectId}" to ground the plan in roadmap priorities.`,
            `5. Call \`get_project_overview\` for the current-term roster.`,
            "",
            "Then draft a sprint plan with:",
            "",
            "- **Sprint goal** — one sentence, ties to the most important open epic.",
            "- **Sprint** — which sprint (label + dates from list_sprints).",
            "- **Carrying over** — unfinished work already rolling into it; account for it before adding more.",
            "- **Candidate tasks** — 8–15 cards from the backlog, in rank order; for each: title, epic, suggested assignee(s), domain, why it belongs.",
            "- **Risks** — anything that would block the sprint (unassigned domain, tasks that have carried over repeatedly, stale info).",
            "",
            "Scheduling a task means setting its `sprintId` with `update_task`. Do NOT call `update_task` yet — produce the plan as a markdown proposal for the user to review.",
          ].join("\n"),
        },
      },
    ];
  },
};
