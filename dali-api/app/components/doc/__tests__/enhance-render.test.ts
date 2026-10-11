// Unit tests for the doc package's pure helpers (node environment — no DOM,
// no BlockNote imports, no ~/lib/db).

import { describe, expect, it } from "vitest";
import type { EnhanceActionItem, EnhanceOpBlock } from "~/components/meeting-recorder/enhance-plan";
import { appendTaskMentionContent, findTranscriptToggle, toPartialBlock, transcriptToggleBlock } from "../enhance-render";
import type { DocBlock } from "../schema/build";

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

describe("transcriptToggleBlock / findTranscriptToggle", () => {
  it("builds a toggleable heading named Transcript with one paragraph per line", () => {
    const block = transcriptToggleBlock(["[00:00] You: hi", "[00:05] Others: hey"]);
    expect(block.type).toBe("heading");
    expect((block.props as { isToggleable?: boolean }).isToggleable).toBe(true);
    expect(block.children).toHaveLength(2);
  });

  it("finds the Transcript toggle among a document's top-level blocks", () => {
    const toggle = transcriptToggleBlock(["[00:00] You: hi"]) as unknown as DocBlock;
    const other = { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "notes", styles: {} }], children: [] } as unknown as DocBlock;
    const found = findTranscriptToggle([other, { ...toggle, id: "t1" }]);
    expect(found?.id).toBe("t1");
  });

  it("returns null when the document has no Transcript toggle", () => {
    const other = { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "notes", styles: {} }], children: [] } as unknown as DocBlock;
    expect(findTranscriptToggle([other])).toBeNull();
  });

  it("does not match a toggleable heading with a different title", () => {
    const decoy = {
      id: "h1",
      type: "heading",
      props: { level: 3, isToggleable: true },
      content: [{ type: "text", text: "Summary", styles: {} }],
      children: [],
    } as unknown as DocBlock;
    expect(findTranscriptToggle([decoy])).toBeNull();
  });

  it("does not match a non-toggleable heading titled Transcript", () => {
    const plainHeading = {
      id: "h1",
      type: "heading",
      props: { level: 3 },
      content: [{ type: "text", text: "Transcript", styles: {} }],
      children: [],
    } as unknown as DocBlock;
    expect(findTranscriptToggle([plainHeading])).toBeNull();
  });
});
