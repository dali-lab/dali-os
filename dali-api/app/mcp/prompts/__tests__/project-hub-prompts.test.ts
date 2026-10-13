import { describe, it, expect } from "vitest";

import { SPRINT_PLANNING_PROMPT } from "~/mcp/prompts/sprint-planning";
import { STANDUP_PROMPT } from "~/mcp/prompts/standup";
import { RETRO_PROMPT } from "~/mcp/prompts/retro";

describe("project hub prompts", () => {
  it("each prompt declares projectId as required", () => {
    for (const prompt of [SPRINT_PLANNING_PROMPT, STANDUP_PROMPT, RETRO_PROMPT]) {
      const projectIdArg = prompt.arguments.find((a) => a.name === "projectId");
      expect(projectIdArg?.required).toBe(true);
    }
  });

  it("sprint-planning interpolates projectId and schedules via sprintId", () => {
    const msgs = SPRINT_PLANNING_PROMPT.build({ projectId: "proj-abc" });
    const text = msgs[0].content.text;
    expect(text).toContain('list_sprints` with projectId="proj-abc"');
    expect(text).toContain("dali://projects/proj-abc/board");
    expect(text).toContain("dali://projects/proj-abc/backlog");
    expect(text).toContain("`sprintId`");
    expect(text).not.toMatch(/due date|its dates/);
  });

  it("standup interpolates projectId", () => {
    const msgs = STANDUP_PROMPT.build({ projectId: "p1" });
    expect(msgs[0].content.text).toContain("dali://projects/p1/board");
  });

  it("retro falls back to 'most recent' wording when sprint is omitted", () => {
    const msgs = RETRO_PROMPT.build({ projectId: "p1" });
    expect(msgs[0].content.text).toContain("most recent");
  });
});
