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
      name: "sprint",
      description:
        "Sprint label to retro, e.g. \"Sprint 3\". If omitted, retro the most recently ended sprint.",
      required: false,
    },
  ],
  build(args) {
    const projectId = args.projectId;
    const sprintHint = args.sprint
      ? `for ${args.sprint}`
      : "for the most recent sprint (find it via list_sprints and pick the latest past sprint)";
    return [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Draft a retrospective ${sprintHint} on project ${projectId}. Sprints are stored one-week windows; when one closes, unfinished tasks roll into the next sprint and the sprint keeps a planned/completed/carried-over snapshot. Use the dalios MCP tools:`,
            "",
            `1. Call \`list_sprints\` with projectId="${projectId}" to find the target sprint and its closing snapshot.`,
            `2. Read resource \`dali://projects/${projectId}/board\` for tasks grouped by sprint (carried tasks now sit in the following sprint and show a carriedOver count).`,
            "",
            "Then write a retrospective with:",
            "",
            "- **What we shipped** — count and titles of tasks moved to Done in the sprint.",
            "- **What slipped** — the sprint's carried-over count, and which tasks rolled (carriedOver ≥ 1 in the next sprint). Call out tasks that have rolled more than once. Note likely cause from titles/assignees.",
            "- **Carryover** — what already rolled into the next sprint, and anything that should go back to the backlog instead.",
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
