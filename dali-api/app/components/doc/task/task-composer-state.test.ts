import { describe, expect, it } from "vitest";
import { composerCanSubmit, composerNeedsDate, composerStatus, taskBlockConfig } from "./task-composer-state";

const projects = [{ id: "p1", name: "Campus Compost" }];

describe("taskBlockConfig", () => {
  it("offers /task in a project doc the viewer can add tasks to", () => {
    expect(taskBlockConfig(projects, "p1")).toEqual({ projectId: "p1", projects });
  });

  it("hides /task in a project doc the viewer can't add tasks to", () => {
    expect(taskBlockConfig(projects, "p2")).toBeNull();
  });

  it("offers /task elsewhere with no project chosen yet", () => {
    expect(taskBlockConfig(projects, null)).toEqual({ projectId: null, projects });
  });

  it("hides /task for someone with no projects", () => {
    expect(taskBlockConfig([], null)).toBeNull();
  });
});

describe("composerStatus", () => {
  it("starts undated drafts in Backlog, the one column that allows them", () => {
    expect(composerStatus(null, "")).toBe("Backlog");
  });

  it("moves to To do once dated", () => {
    expect(composerStatus(null, "2026-11-07")).toBe("Todo");
  });

  it("keeps a status the author picked, dated or not", () => {
    expect(composerStatus("InProgress", "")).toBe("InProgress");
    expect(composerStatus("Backlog", "2026-11-07")).toBe("Backlog");
  });
});

describe("composerNeedsDate", () => {
  it("is only true outside Backlog with no date", () => {
    expect(composerNeedsDate("Todo", "")).toBe(true);
    expect(composerNeedsDate("Backlog", "")).toBe(false);
    expect(composerNeedsDate("Todo", "2026-11-07")).toBe(false);
  });
});

describe("composerCanSubmit", () => {
  const ready = { title: "Send the SOW", projectId: "p1", status: "Backlog", dueDate: "" } as const;

  it("accepts a titled draft on a project", () => {
    expect(composerCanSubmit(ready)).toBe(true);
  });

  it("needs a title with real text", () => {
    expect(composerCanSubmit({ ...ready, title: "   " })).toBe(false);
  });

  it("needs a project", () => {
    expect(composerCanSubmit({ ...ready, projectId: null })).toBe(false);
  });

  it("needs a date outside Backlog", () => {
    expect(composerCanSubmit({ ...ready, status: "InReview" })).toBe(false);
  });
});
