import { describe, expect, it } from "vitest";
import { createStatus } from "../task-draft";

const viewed = { periodId: "f", week: 8 };

describe("createStatus", () => {
  it("starts in To do when assigned and due in the viewed week", () => {
    expect(createStatus({ assigneeIds: ["me"], periodId: "f", week: 8 }, viewed)).toBe("Todo");
  });

  it("goes to the backlog when unassigned", () => {
    expect(createStatus({ assigneeIds: [], periodId: "f", week: 8 }, viewed)).toBe("Backlog");
  });

  it("goes to the backlog when due in another week or term", () => {
    expect(createStatus({ assigneeIds: ["me"], periodId: "f", week: 9 }, viewed)).toBe("Backlog");
    expect(createStatus({ assigneeIds: ["me"], periodId: "w", week: 8 }, viewed)).toBe("Backlog");
  });

  it("goes to the backlog when no week is being viewed", () => {
    expect(createStatus({ assigneeIds: ["me"], periodId: "f", week: 8 }, null)).toBe("Backlog");
  });
});
