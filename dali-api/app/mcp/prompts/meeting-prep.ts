// MCP prompt `meeting-prep` — pre-meeting briefing. Caller provides a meeting
// title fragment or full title to identify the target; the model finds it in
// the upcoming-meetings list, then enriches attendees and produces an agenda.

import type { PromptDefinition } from "./types";

export const MEETING_PREP_PROMPT: PromptDefinition = {
  name: "meeting-prep",
  description:
    "Draft an agenda + talking points for an upcoming meeting using attendee profiles and shared task context.",
  arguments: [
    {
      name: "meetingHint",
      description:
        "A fragment of the meeting title or the participant name. Used to disambiguate against the upcoming-meetings list.",
      required: true,
    },
  ],
  build(args) {
    const hint = (args.meetingHint ?? "").trim();
    return [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Help me prepare for an upcoming DALI OS meeting. The user described it as: "${hint}".`,
            "",
            "Steps (use the dalios MCP tools):",
            "",
            "1. Call `list_my_upcoming_meetings` with `daysAhead: 14`. Find the meeting that best matches the user's description. If you can't pick a single one, ask the user to clarify before continuing.",
            "2. For each participantUserId on that meeting, call `get_member_profile` to pull their role/domains. Skip the caller themselves.",
            "3. If the meeting title hints at a project (e.g. a project name), call `list_my_projects` to find a matching id, then `get_project_overview` for that project so you have current sprint/epic context.",
            "",
            "Then write the briefing as markdown with these sections:",
            "",
            "- **Meeting** — title, time, duration, location/link if any.",
            "- **Attendees** — one bullet per person: name, role, relevant domains.",
            "- **Context** — 2–3 bullets on the project/topic if you found one.",
            "- **Suggested agenda** — 3–5 numbered items. Be specific, not generic.",
            "- **Questions worth raising** — 2–3 short questions.",
            "",
            "Keep the briefing scannable — bullets over paragraphs. Stop and ask if any step returns nothing useful.",
          ].join("\n"),
        },
      },
    ];
  },
};
