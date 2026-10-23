import { describe, it, expect } from "vitest";
import type { DocBlock } from "~/collab/blocknote-server";
import { actionItemsOf, noteOutline, notePageId } from "../mobile-notes";

const text = (t: string) => [{ type: "text", text: t, styles: {} }] as unknown as DocBlock["content"];
const block = (type: string, t: string, props: Record<string, unknown> = {}, children: DocBlock[] = []): DocBlock => ({
  id: `${type}-${t}`,
  type,
  props,
  content: text(t),
  children,
});

describe("noteOutline", () => {
  it("maps headings, paragraphs, bullets and checklist items", () => {
    const outline = noteOutline([
      block("heading", "Summary", { level: 2 }),
      block("paragraph", "Sprint kickoff."),
      block("bulletListItem", "Guides by Friday"),
      block("numberedListItem", "Hand off designs"),
      block("checkListItem", "Ship it", { checked: true }),
      block("checkListItem", "Review it"),
    ]);
    expect(outline).toEqual([
      { kind: "heading", text: "Summary", level: 2 },
      { kind: "text", text: "Sprint kickoff.", depth: 0 },
      { kind: "bullet", text: "Guides by Friday", depth: 0 },
      { kind: "bullet", text: "Hand off designs", depth: 0 },
      { kind: "check", text: "Ship it", depth: 0, checked: true },
      { kind: "check", text: "Review it", depth: 0, checked: false },
    ]);
  });

  it("nests children one level deeper", () => {
    const outline = noteOutline([block("bulletListItem", "Parent", {}, [block("bulletListItem", "Child")])]);
    expect(outline).toEqual([
      { kind: "bullet", text: "Parent", depth: 0 },
      { kind: "bullet", text: "Child", depth: 1 },
    ]);
  });

  it("drops the Transcript toggle and everything under it", () => {
    const outline = noteOutline([
      block("paragraph", "Kept"),
      block("heading", "Transcript", { isToggleable: true, level: 3 }, [block("paragraph", "[00:01] You: hi")]),
    ]);
    expect(outline).toEqual([{ kind: "text", text: "Kept", depth: 0 }]);
  });

  it("keeps a plain heading that happens to say Transcript", () => {
    expect(noteOutline([block("heading", "Transcript", { level: 2 })])).toEqual([
      { kind: "heading", text: "Transcript", level: 2 },
    ]);
  });

  it("skips empty blocks but keeps their children", () => {
    const empty: DocBlock = { id: "e", type: "paragraph", props: {}, content: [], children: [block("paragraph", "Inside")] };
    expect(noteOutline([empty])).toEqual([{ kind: "text", text: "Inside", depth: 1 }]);
  });

  it("defaults a heading without a valid level to 1", () => {
    expect(noteOutline([block("heading", "Notes", { level: "big" })])).toEqual([
      { kind: "heading", text: "Notes", level: 1 },
    ]);
  });
});

describe("actionItemsOf", () => {
  it("numbers the plan's action items and fills missing fields with null", () => {
    const notes = {
      plan: {
        blocks: [],
        actionItems: [
          { text: "Fill in Guides", ownerUserId: "u1", ownerName: "Sophie", due: "2026-10-23", taskId: "t1" },
          { text: "Check the cache" },
        ],
      },
    };
    expect(actionItemsOf(notes)).toEqual([
      { index: 0, text: "Fill in Guides", ownerUserId: "u1", ownerName: "Sophie", due: "2026-10-23", taskId: "t1" },
      { index: 1, text: "Check the cache", ownerUserId: null, ownerName: null, due: null, taskId: null },
    ]);
  });

  it.each([null, undefined, {}, { plan: {} }, { plan: { actionItems: "nope" } }])("is empty for %j", (notes) => {
    expect(actionItemsOf(notes)).toEqual([]);
  });
});

describe("notePageId", () => {
  it("reads the page id out of a doc room", () => {
    expect(notePageId("doc:page123:body")).toBe("page123");
  });

  it.each(["project:p1:readme", "doc:", "", "presence:x"])("is null for %j", (name) => {
    expect(notePageId(name)).toBeNull();
  });
});
