// MCP prompt `retro` — drafts a sprint retrospective from a closed sprint.

import type { PromptDefinition } from "./types";

export const RETRO_PROMPT: PromptDefinition = {
  name: "retro",
  description:
    "Draft a sprint retrospective: what shipped, what slipped, what to try differently next sprint.",
  arguments: [
    {
      name: "projectId",
      description: "Project.id.",
      required: true,
    },
    {
      name: "sprintId",
      description: "Sprint.id to retro. If omitted, retro the most recent Active or Closed sprint.",
      required: false,
    },
  ],
  build(args) {
    const projectId = args.projectId;
    const sprintHint = args.sprintId
      ? `for sprint ${args.sprintId}`
      : "for the most recent sprint (find it via list_sprints and pick the latest Active or Closed one)";
    return [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Draft a retrospective ${sprintHint} on project ${projectId}. Use the dalios MCP tools:`,
            "",
            `1. Call \`list_sprints\` with projectId="${projectId}" to find the target sprint if not given.`,
            `2. Call \`list_my_tasks\` (filter by status to include Done/Cancelled) and use \`get_project_overview\` to find tasks in that sprint by id.`,
            `3. Read resource \`dali://projects/${projectId}/board\` for the full task snapshot.`,
            "",
            "Then write a retrospective with:",
            "",
            "- **What we shipped** — count and titles of tasks moved to Done in the sprint.",
            "- **What slipped** — tasks still in Todo/InProgress at the end, or Cancelled mid-sprint. Note likely cause from titles/assignees.",
            "- **Carryover** — concrete cards to roll into the next sprint.",
            "- **Process notes** — anything visible from the board about workload balance, domain coverage, or assignee load.",
            "- **Try next sprint** — 2–3 small, specific changes (not platitudes).",
            "",
            "Keep it under ~300 words. If you can't tell something from the data, say so instead of inventing.",
          ].join("\n"),
        },
      },
    ];
  },
};
