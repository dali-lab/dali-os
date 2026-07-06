// MCP prompt `sprint-planning` — drafts the next sprint for a project. The
// prompt instructs the model to read the board resource + backlog + epics
// and produce a candidate sprint plan.

import type { PromptDefinition } from "./types";

export const SPRINT_PLANNING_PROMPT: PromptDefinition = {
  name: "sprint-planning",
  description:
    "Draft a candidate next sprint for a project: pick tasks from the backlog, balance assignees, suggest a goal.",
  arguments: [
    {
      name: "projectId",
      description: "Project.id (as returned by list_my_projects).",
      required: true,
    },
    {
      name: "sprintLengthDays",
      description: "Target sprint length in days (default 14).",
      required: false,
    },
  ],
  build(args) {
    const projectId = args.projectId;
    const sprintLength = args.sprintLengthDays || "14";
    return [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Plan the next sprint for project ${projectId}. Use the dalios MCP tools:`,
            "",
            `1. Read resource \`dali://projects/${projectId}/board\` for current sprint state.`,
            `2. Read resource \`dali://projects/${projectId}/backlog\` for unscheduled work.`,
            `3. Call \`list_epics\` with projectId="${projectId}" to ground the plan in roadmap priorities.`,
            `4. Call \`get_project_overview\` for the current-term roster.`,
            "",
            "Then draft a sprint plan with:",
            "",
            `- **Sprint goal** — one sentence, ties to the most important open epic.`,
            `- **Sprint window** — a ${sprintLength}-day window starting next Monday (ISO dates).`,
            "- **Candidate tasks** — 8–15 cards from the backlog, prioritized; for each: title, suggested assignee(s), domain, why it belongs.",
            "- **Risks** — anything that would block the sprint (unassigned domain, blocked dependency, stale info).",
            "",
            "Do NOT call `create_sprint` or `update_task` yet — produce the plan as a markdown proposal for the user to review.",
          ].join("\n"),
        },
      },
    ];
  },
};
