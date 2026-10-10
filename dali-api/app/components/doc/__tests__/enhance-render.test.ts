// Unit tests for the doc package's pure helpers (node environment — no DOM,
// no BlockNote imports, no ~/lib/db).

import { describe, expect, it } from "vitest";
import { appendTaskMentionContent } from "../enhance-render";

describe("appendTaskMentionContent", () => {
  it("appends a space + taskMention node to existing content", () => {
    const content = appendTaskMentionContent(
      [{ type: "text", text: "Ship it", styles: {} }] as never,
      { taskId: "t1", projectId: "proj1", label: "Ship it" },
    );
    expect(content).toEqual([
      { type: "text", text: "Ship it", styles: {} },
      { type: "text", text: " ", styles: {} },
      { type: "taskMention", props: { taskId: "t1", projectId: "proj1", label: "Ship it" } },
    ]);
  });

  it("starts a fresh array when the block had no content yet", () => {
    const content = appendTaskMentionContent(undefined, {
      taskId: "t2",
      projectId: "proj2",
      label: "Draft the brief",
    });
    expect(content).toEqual([
      { type: "text", text: " ", styles: {} },
      { type: "taskMention", props: { taskId: "t2", projectId: "proj2", label: "Draft the brief" } },
    ]);
  });

  it("does not mutate the input content array", () => {
    const original = [{ type: "text", text: "x", styles: {} }] as never;
    const before = JSON.stringify(original);
    appendTaskMentionContent(original, { taskId: "t3", projectId: "p3", label: "x" });
    expect(JSON.stringify(original)).toBe(before);
  });
});
