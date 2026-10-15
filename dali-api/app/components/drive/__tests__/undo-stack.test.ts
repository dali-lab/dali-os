import { describe, expect, it, vi } from "vitest";
import {
  UNDO_LIMIT,
  emptyStack,
  markRedone,
  markUndone,
  peekRedo,
  peekUndo,
  pushEntry,
  stackView,
  type UndoEntry,
} from "~/components/drive/undo-stack";

const entry = (label: string): UndoEntry => ({ label, undo: vi.fn(async () => {}), redo: vi.fn(async () => {}) });

describe("undo stack", () => {
  it("starts empty", () => {
    expect(stackView(emptyStack)).toEqual({ canUndo: false, canRedo: false });
    expect(peekUndo(emptyStack)).toBeNull();
    expect(peekRedo(emptyStack)).toBeNull();
  });

  it("makes the latest push the next undo", () => {
    const a = entry("a");
    const b = entry("b");
    const stack = pushEntry(pushEntry(emptyStack, a), b);
    expect(peekUndo(stack)).toBe(b);
    expect(stackView(stack)).toEqual({ canUndo: true, canRedo: false });
  });

  it("moves an undone entry to the redo side", () => {
    const a = entry("a");
    const b = entry("b");
    const undone = markUndone(pushEntry(pushEntry(emptyStack, a), b), b);
    expect(peekUndo(undone)).toBe(a);
    expect(peekRedo(undone)).toBe(b);
    expect(stackView(undone)).toEqual({ canUndo: true, canRedo: true });
  });

  it("moves a redone entry back and keeps the rest of the redo side", () => {
    const a = entry("a");
    const b = entry("b");
    let stack = pushEntry(pushEntry(emptyStack, a), b);
    stack = markUndone(markUndone(stack, b), a);
    expect(peekRedo(stack)).toBe(a);
    stack = markRedone(stack, a);
    expect(peekUndo(stack)).toBe(a);
    expect(peekRedo(stack)).toBe(b);
  });

  it("clears the redo side when a new action is pushed", () => {
    const a = entry("a");
    const stack = pushEntry(markUndone(pushEntry(emptyStack, a), a), entry("b"));
    expect(stackView(stack).canRedo).toBe(false);
  });

  it("undoes an entry that is not the latest, leaving the others in order", () => {
    const a = entry("a");
    const b = entry("b");
    const c = entry("c");
    const stack = markUndone(pushEntry(pushEntry(pushEntry(emptyStack, a), b), c), b);
    expect(stack.past).toEqual([a, c]);
    expect(peekRedo(stack)).toBe(b);
  });

  it("ignores undoing or redoing an entry it does not hold", () => {
    const a = entry("a");
    const stranger = entry("x");
    const stack = pushEntry(emptyStack, a);
    expect(markUndone(stack, stranger)).toBe(stack);
    expect(markRedone(stack, stranger)).toBe(stack);
  });

  it("keeps only the newest entries past the cap", () => {
    let stack = emptyStack;
    const all = Array.from({ length: UNDO_LIMIT + 5 }, (_, i) => entry(String(i)));
    for (const e of all) stack = pushEntry(stack, e);
    expect(UNDO_LIMIT).toBe(20);
    expect(stack.past).toHaveLength(20);
    expect(stack.past[0]).toBe(all[5]);
    expect(peekUndo(stack)).toBe(all[all.length - 1]);
  });

  it("caps the undo side when a redo brings entries back", () => {
    let stack = emptyStack;
    for (let i = 0; i < UNDO_LIMIT; i++) stack = pushEntry(stack, entry(String(i)));
    const last = peekUndo(stack)!;
    stack = markUndone(stack, last);
    stack = pushEntry(stack, entry("new"));
    expect(stack.past).toHaveLength(UNDO_LIMIT);
  });

  it("does not mutate the stack it was given", () => {
    const a = entry("a");
    const before = pushEntry(emptyStack, a);
    markUndone(before, a);
    expect(before.past).toEqual([a]);
    expect(before.future).toEqual([]);
  });
});
