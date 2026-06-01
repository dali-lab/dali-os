import { describe, it, expect } from "vitest";
import { WEEKLY_DIGEST_PROMPT } from "~/mcp/prompts/weekly-digest";
import { MEETING_PREP_PROMPT } from "~/mcp/prompts/meeting-prep";
import { PROJECT_STATUS_PROMPT } from "~/mcp/prompts/project-status";

describe("mcp prompts", () => {
  it("weekly-digest is argument-free and references the read tools by name", () => {
    expect(WEEKLY_DIGEST_PROMPT.arguments).toEqual([]);
    const [msg] = WEEKLY_DIGEST_PROMPT.build({});
    expect(msg.role).toBe("user");
    expect(msg.content.type).toBe("text");
    expect(msg.content.text).toContain("list_my_tasks");
    expect(msg.content.text).toContain("list_my_upcoming_meetings");
    expect(msg.content.text).toContain("list_my_notifications");
  });

  it("meeting-prep declares a required meetingHint and inlines it", () => {
    const [hint] = MEETING_PREP_PROMPT.arguments;
    expect(hint.name).toBe("meetingHint");
    expect(hint.required).toBe(true);
    const [msg] = MEETING_PREP_PROMPT.build({ meetingHint: "Standup with Pat" });
    expect(msg.content.text).toContain('"Standup with Pat"');
    expect(msg.content.text).toContain("get_member_profile");
  });

  it("project-status accepts optional audience hint and shapes the prompt accordingly", () => {
    const required = PROJECT_STATUS_PROMPT.arguments.find((a) => a.required);
    expect(required?.name).toBe("projectHint");
    const optional = PROJECT_STATUS_PROMPT.arguments.find((a) => !a.required);
    expect(optional?.name).toBe("audience");

    const withAudience = PROJECT_STATUS_PROMPT.build({
      projectHint: "Alpha",
      audience: "partner",
    });
    expect(withAudience[0].content.text).toContain("partner");

    const withoutAudience = PROJECT_STATUS_PROMPT.build({ projectHint: "Alpha" });
    expect(withoutAudience[0].content.text).toContain("Audience unspecified");
  });
});
