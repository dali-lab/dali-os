import { describe, expect, it, vi } from "vitest";
import type { DocEditorInstance } from "../schema/build";
import { placeTaskBlock, replaceWithTaskBlock } from "./place-task-block";

type FakeBlock = { id: string; type: string; content?: unknown };

function fakeEditor(blocks: FakeBlock[]) {
  const doc = [...blocks];
  const inserted = (b: { type: string }): FakeBlock => ({ id: `new-${b.type}`, type: b.type });
  const at = (id: string) => doc.findIndex((b) => b.id === id);
  const editor = {
    get document() {
      return doc;
    },
    getBlock: (id: string) => doc.find((b) => b.id === id),
    getNextBlock: (b: FakeBlock) => doc[at(b.id) + 1],
    replaceBlocks: vi.fn((old: FakeBlock[], next: { type: string }[]) => {
      const made = next.map(inserted);
      doc.splice(at(old[0]!.id), old.length, ...made);
      return { insertedBlocks: made };
    }),
    insertBlocks: vi.fn((next: { type: string }[], ref: FakeBlock) => {
      const made = next.map(inserted);
      doc.splice(at(ref.id) + 1, 0, ...made);
      return made;
    }),
    setTextCursorPosition: vi.fn(),
    focus: vi.fn(),
  };
  return editor as typeof editor & DocEditorInstance;
}

const task = { taskId: "t1", projectId: "p1", label: "Send the SOW" };
const types = (e: ReturnType<typeof fakeEditor>) => e.document.map((b) => b.type);

describe("placeTaskBlock", () => {
  it("takes over the empty line /task was typed on", () => {
    const editor = fakeEditor([
      { id: "a", type: "paragraph", content: [] },
      { id: "b", type: "paragraph", content: [{ text: "next" }] },
    ]);
    placeTaskBlock(editor, "a", task);
    expect(types(editor)).toEqual(["task", "paragraph"]);
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }), "start");
  });

  it("keeps a line with text and goes after it", () => {
    const editor = fakeEditor([
      { id: "a", type: "paragraph", content: [{ text: "keep me" }] },
      { id: "b", type: "paragraph", content: [] },
    ]);
    placeTaskBlock(editor, "a", task);
    expect(types(editor)).toEqual(["paragraph", "task", "paragraph"]);
  });

  it("adds a line to type on when the task lands last", () => {
    const editor = fakeEditor([{ id: "a", type: "paragraph", content: [] }]);
    placeTaskBlock(editor, "a", task);
    expect(types(editor)).toEqual(["task", "paragraph"]);
  });

  it("falls back to the end of the doc if a collaborator deleted the line", () => {
    const editor = fakeEditor([{ id: "z", type: "paragraph", content: [{ text: "other" }] }]);
    placeTaskBlock(editor, "gone", task);
    expect(types(editor)).toEqual(["paragraph", "task", "paragraph"]);
  });
});

describe("replaceWithTaskBlock", () => {
  it("swaps a text line for a task block without moving the caret", () => {
    const editor = fakeEditor([
      { id: "a", type: "paragraph", content: [{ text: "Send the SOW" }] },
      { id: "b", type: "paragraph", content: [{ text: "next" }] },
    ]);
    expect(replaceWithTaskBlock(editor, "a", task)).toBe(true);
    expect(types(editor)).toEqual(["task", "paragraph"]);
    expect(editor.setTextCursorPosition).not.toHaveBeenCalled();
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it("does nothing when the line is gone", () => {
    const editor = fakeEditor([{ id: "a", type: "paragraph", content: [] }]);
    expect(replaceWithTaskBlock(editor, "gone", task)).toBe(false);
    expect(editor.replaceBlocks).not.toHaveBeenCalled();
  });
});
