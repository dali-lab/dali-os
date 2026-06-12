// MCP prompt `standup` — drafts a project standup summary from current
// board state.

import type { PromptDefinition } from "./types";

export const STANDUP_PROMPT: PromptDefinition = {
  name: "standup",
  description:
    "Synthesize a project standup summary: what moved yesterday, what's in flight today, what's blocked.",
  arguments: [
    {
      name: "projectId",
      description: "Project.id.",
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
            `Generate today's standup notes for project ${projectId}. Use the dalios MCP tools:`,
            "",
            `1. Read resource \`dali://projects/${projectId}/board\` for the full current sprint state.`,
            `2. Call \`get_project_overview\` for the active sprint and current epic context.`,
            "",
            "Then write a short standup briefing:",
            "",
            "- **In progress** — every task currently in 'InProgress' or 'InReview', grouped by assignee.",
            "- **Moved to Done since yesterday** — tasks now in Done. (If you can't tell from the snapshot, say so explicitly rather than guessing.)",
            "- **Blocked or stale** — InProgress tasks with no assignee, missing domain, or visible due-date risk.",
            "- **Today's focus** — top 3 cards the team should push on (your judgment; cite task ids).",
            "",
            "Keep the whole standup under ~200 words.",
          ].join("\n"),
        },
      },
    ];
  },
};
