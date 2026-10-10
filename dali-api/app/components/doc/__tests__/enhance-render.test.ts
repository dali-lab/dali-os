// Unit tests for the doc package's pure helpers (node environment — no DOM,
// no BlockNote imports, no ~/lib/db).

import { describe, expect, it } from "vitest";
import type { EnhanceActionItem, EnhanceOpBlock } from "~/components/meeting-recorder/enhance-plan";
import { appendTaskMentionContent, toPartialBlock } from "../enhance-render";

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

// Create tasks can run BEFORE Apply (specs/meeting-notes-model.md §4), so the
// checklist block Apply inserts never existed for onTaskCreated to link a
// task to — toPartialBlock links it itself as it inserts the block.
describe("toPartialBlock — linking a checklist insert to an already-created task", () => {
  const checklistBlock = (text: string): EnhanceOpBlock => ({ type: "checkListItem", text, cites: [], added: true });

  it("appends a taskMention when the inserted checklist text matches an action item with a taskId", () => {
    const actionItems: EnhanceActionItem[] = [{ text: "Send the revised scope", taskId: "task1" }];
    const result = toPartialBlock(checklistBlock("Send the revised scope"), "p1", "rec1", {
      actionItems,
      projectId: "proj1",
    });
    expect(JSON.stringify(result.content)).toContain("taskMention");
    expect(JSON.stringify(result.content)).toContain("task1");
  });

  it("does not append a taskMention when the matching action item has no taskId yet", () => {
    const actionItems: EnhanceActionItem[] = [{ text: "Send the revised scope" }];
    const result = toPartialBlock(checklistBlock("Send the revised scope"), "p1", "rec1", {
      actionItems,
      projectId: "proj1",
    });
    expect(JSON.stringify(result.content)).not.toContain("taskMention");
  });

  it("does not append a taskMention without a projectId, even with a taskId match", () => {
    const actionItems: EnhanceActionItem[] = [{ text: "Send the revised scope", taskId: "task1" }];
    const result = toPartialBlock(checklistBlock("Send the revised scope"), "p1", "rec1", { actionItems });
    expect(JSON.stringify(result.content)).not.toContain("taskMention");
  });

  it("does not append a taskMention when no action item's text matches the block", () => {
    const actionItems: EnhanceActionItem[] = [{ text: "Book the conference room", taskId: "task1" }];
    const result = toPartialBlock(checklistBlock("Send the revised scope"), "p1", "rec1", {
      actionItems,
      projectId: "proj1",
    });
    expect(JSON.stringify(result.content)).not.toContain("taskMention");
  });

  it("still renders an unchecked checklist block when ctx is omitted entirely", () => {
    const result = toPartialBlock(checklistBlock("Send the revised scope"), "p1", "rec1");
    expect(result.type).toBe("checkListItem");
    expect(result.props).toEqual({ checked: false });
  });
});
