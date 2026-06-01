// MCP prompt `weekly-digest` — produces a "what should I focus on this week"
// briefing for the caller. The prompt instructs the model to call the
// existing read tools (`list_my_notifications`, `list_my_upcoming_meetings`,
// `list_my_tasks`) and synthesize, so all data is fetched live.

import type { PromptDefinition } from "./types";

export const WEEKLY_DIGEST_PROMPT: PromptDefinition = {
  name: "weekly-digest",
  description:
    "Synthesize a personal weekly briefing: priority tasks, upcoming meetings, unread announcements.",
  arguments: [],
  build() {
    return [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Generate a weekly DALI OS digest for me. Use the dalios MCP tools:",
            "",
            "1. Call `list_my_tasks` (no args — defaults to my open work).",
            "2. Call `list_my_upcoming_meetings` with `daysAhead: 7`.",
            "3. Call `list_my_notifications` with `onlyUnread: true`.",
            "",
            "Then write a short briefing with these sections:",
            "",
            "- **This week's focus** — at most 5 tasks, picked by due date and priority. Note overdue items explicitly.",
            "- **Meetings** — chronological list, one line each: time, title, who else is there (use `get_member_profile` if a name would help).",
            "- **Unread inbox** — group by kind (announcements vs. invites vs. other); summarize each in one line.",
            "- **Suggested next action** — a single concrete thing to do right now.",
            "",
            "Keep the whole digest under ~250 words. If a section is empty, say so in one short sentence instead of fabricating items.",
          ].join("\n"),
        },
      },
    ];
  },
};
