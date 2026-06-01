// MCP prompt `project-status` — draft a project status update using
// `get_project_overview` + `list_my_tasks` (scoped to the project). The caller
// can either pass a `projectId` directly or hint at the project by name and
// the model resolves it via `list_my_projects`.

import type { PromptDefinition } from "./types";

export const PROJECT_STATUS_PROMPT: PromptDefinition = {
  name: "project-status",
  description:
    "Draft a project status report (progress, risks, next steps) using current sprint, epic, and task data.",
  arguments: [
    {
      name: "projectHint",
      description:
        "Either a Project.id or a fragment of the project name. The model resolves it against `list_my_projects` if not an id.",
      required: true,
    },
    {
      name: "audience",
      description:
        "Optional audience hint, e.g. 'partner', 'core', 'mentor'. Shapes the tone and detail level.",
      required: false,
    },
  ],
  build(args) {
    const hint = (args.projectHint ?? "").trim();
    const audience = (args.audience ?? "").trim();
    const audienceLine = audience
      ? `Audience for this update: ${audience}. Match the tone accordingly (e.g. partner = less jargon, mentor = focus on member growth, core = operational).`
      : "Audience unspecified — write neutrally; ask the user who it's for if a tone choice matters.";

    return [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Draft a status update for the DALI project the user described as: "${hint}".`,
            "",
            audienceLine,
            "",
            "Steps (use the dalios MCP tools):",
            "",
            "1. If the hint looks like an id (cuid-shaped), use it directly. Otherwise call `list_my_projects` and pick the best name match. Confirm with the user if ambiguous.",
            "2. Call `get_project_overview` with the resolved projectId.",
            "3. Call `list_my_tasks` with that projectId AND `status: ['Todo','InProgress','InReview','Done']` to see recently-finished work alongside open work.",
            "",
            "Then write the update as markdown with these sections:",
            "",
            "- **Headline** — one sentence summary.",
            "- **This sprint** — what shipped, what's in progress (use the Done + InReview tasks).",
            "- **Up next** — top 3 Todo items.",
            "- **Risks / blockers** — items overdue or stuck. Be honest; if there are none, say so.",
            "- **Asks** — anything the audience can help with.",
            "",
            "Keep it under 200 words. Don't invent metrics that aren't in the tool output.",
          ].join("\n"),
        },
      },
    ];
  },
};
