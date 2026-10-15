// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { ToastProvider } from "~/components/ui/toast";
import { useDriveHistory, useDriveHistoryKeys } from "~/components/drive/use-drive-history";
import type { UndoEntry } from "~/components/drive/undo-stack";
import { renderHook } from "./render-hook";

const wrapper = (children: ReactNode) => createElement(ToastProvider, null, children);
const mounted: Array<() => void> = [];
afterEach(() => {
  mounted.splice(0).forEach((u) => u());
  document.body.innerHTML = "";
});

function mount(onChange?: () => void) {
  const hook = renderHook(
    ({ onChange }: { onChange?: () => void }) => {
      const history = useDriveHistory({ onChange });
      useDriveHistoryKeys(history);
      return history;
    },
    { initialProps: { onChange }, wrapper },
  );
  mounted.push(hook.unmount);
  return hook;
}

const entry = (label: string, over: Partial<UndoEntry> = {}): UndoEntry => ({
  label,
  undo: vi.fn(async () => {}),
  redo: vi.fn(async () => {}),
  ...over,
});

const toastText = () => document.body.textContent ?? "";

function press(init: KeyboardEventInit & { key: string }, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(event));
  return event;
}

describe("useDriveHistory", () => {
  it("starts with nothing to undo or redo", () => {
    const { result } = mount();
    expect(result.current.canUndo()).toBe(false);
    expect(result.current.canRedo()).toBe(false);
  });

  it("hands back the entry it records", () => {
    const { result } = mount();
    const e = entry("Move");
    expect(result.current.record(e)).toBe(e);
    expect(result.current.canUndo()).toBe(true);
  });

  it("undoes the latest entry, says so, and revalidates", async () => {
    const onChange = vi.fn();
    const { result } = mount(onChange);
    const a = entry("Move");
    const b = entry("Filing");
    result.current.record(a);
    result.current.record(b);
    await act(async () => result.current.undo());
    expect(b.undo).toHaveBeenCalledTimes(1);
    expect(a.undo).not.toHaveBeenCalled();
    expect(toastText()).toContain("Filing undone");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(result.current.canRedo()).toBe(true);
  });

  it("redoes what was undone", async () => {
    const onChange = vi.fn();
    const { result } = mount(onChange);
    const a = entry("Move");
    result.current.record(a);
    await act(async () => result.current.undo());
    await act(async () => result.current.redo());
    expect(a.redo).toHaveBeenCalledTimes(1);
    expect(toastText()).toContain("Move redone");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(result.current.canRedo()).toBe(false);
    expect(result.current.canUndo()).toBe(true);
  });

  it("uses an entry's own messages", async () => {
    const { result } = mount();
    result.current.record(entry("Delete", { undoneMessage: "Restored “Notes”", redoneMessage: "Moved “Notes” to Trash" }));
    await act(async () => result.current.undo());
    expect(toastText()).toContain("Restored “Notes”");
    await act(async () => result.current.redo());
    expect(toastText()).toContain("Moved “Notes” to Trash");
  });

  it("does nothing when there is nothing to undo or redo", async () => {
    const onChange = vi.fn();
    const { result } = mount(onChange);
    await act(async () => result.current.undo());
    await act(async () => result.current.redo());
    expect(onChange).not.toHaveBeenCalled();
    expect(toastText()).toBe("");
  });

  it("keeps the entry and shows the reason when undo fails", async () => {
    const onChange = vi.fn();
    const { result } = mount(onChange);
    const e = entry("Move", { undo: vi.fn(async () => Promise.reject(new Error("Couldn't put everything back"))) });
    result.current.record(e);
    await act(async () => result.current.undo());
    expect(toastText()).toContain("Couldn't put everything back");
    expect(result.current.canUndo()).toBe(true);
    expect(result.current.canRedo()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain message for an error without one", async () => {
    const { result } = mount();
    result.current.record(entry("Move", { undo: vi.fn(async () => Promise.reject("x")) }));
    await act(async () => result.current.undo());
    expect(toastText()).toContain("Couldn't undo that");
  });

  it("drops the redo side when a new action is recorded", async () => {
    const { result } = mount();
    result.current.record(entry("a"));
    await act(async () => result.current.undo());
    result.current.record(entry("b"));
    expect(result.current.canRedo()).toBe(false);
  });

  it("ignores a second undo while the first is still running", async () => {
    const { result } = mount();
    let finish!: () => void;
    const slow = entry("Move", { undo: vi.fn(() => new Promise<void>((r) => (finish = r))) });
    result.current.record(slow);
    result.current.record(entry("later"));
    result.current.record(slow);
    let first!: Promise<void>;
    act(() => {
      first = result.current.undo();
    });
    await act(async () => result.current.undo());
    expect(slow.undo).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await first;
    });
  });

  describe("undoEntry (the toast's Undo)", () => {
    it("undoes that entry, which is the latest, the same as undo()", async () => {
      const { result } = mount();
      const e = entry("Move");
      result.current.record(e);
      await act(async () => result.current.undoEntry(e));
      expect(e.undo).toHaveBeenCalledTimes(1);
      expect(result.current.canUndo()).toBe(false);
      expect(result.current.canRedo()).toBe(true);
    });

    it("undoes an older entry without touching the newer one", async () => {
      const { result } = mount();
      const older = entry("Move");
      const newer = entry("Filing");
      result.current.record(older);
      result.current.record(newer);
      await act(async () => result.current.undoEntry(older));
      expect(older.undo).toHaveBeenCalledTimes(1);
      expect(newer.undo).not.toHaveBeenCalled();
      await act(async () => result.current.undo());
      expect(newer.undo).toHaveBeenCalledTimes(1);
    });

    it("does nothing for an entry that was already undone", async () => {
      const { result } = mount();
      const e = entry("Move");
      result.current.record(e);
      await act(async () => result.current.undo());
      await act(async () => result.current.undoEntry(e));
      expect(e.undo).toHaveBeenCalledTimes(1);
    });

    it("does nothing for an entry it never recorded", async () => {
      const { result } = mount();
      const e = entry("Move");
      await act(async () => result.current.undoEntry(e));
      expect(e.undo).not.toHaveBeenCalled();
    });
  });
});

describe("useDriveHistoryKeys", () => {
  it("undoes on Cmd+Z and stops the browser's own handling", async () => {
    const { result } = mount();
    const e = entry("Move");
    result.current.record(e);
    let event!: KeyboardEvent;
    await act(async () => {
      event = press({ key: "z", metaKey: true });
    });
    expect(e.undo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("redoes on Cmd+Shift+Z and on Ctrl+Y", async () => {
    const { result } = mount();
    const e = entry("Move");
    result.current.record(e);
    await act(async () => void press({ key: "z", metaKey: true }));
    await act(async () => void press({ key: "Z", metaKey: true, shiftKey: true }));
    expect(e.redo).toHaveBeenCalledTimes(1);
    await act(async () => void press({ key: "z", ctrlKey: true }));
    await act(async () => void press({ key: "y", ctrlKey: true }));
    expect(e.redo).toHaveBeenCalledTimes(2);
  });

  it("leaves the key alone when there is nothing to undo", () => {
    mount();
    const event = press({ key: "z", metaKey: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves the key to a text field", async () => {
    const { result } = mount();
    const e = entry("Move");
    result.current.record(e);
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = press({ key: "z", metaKey: true }, input);
    expect(e.undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves the key to a document being edited", async () => {
    const { result } = mount();
    const e = entry("Move");
    result.current.record(e);
    const editor = document.createElement("div");
    editor.className = "bn-editor";
    const inner = document.createElement("p");
    editor.appendChild(inner);
    document.body.appendChild(editor);
    press({ key: "z", metaKey: true }, inner);
    expect(e.undo).not.toHaveBeenCalled();
  });

  it("leaves the key alone while a dialog is open", async () => {
    const { result } = mount();
    const e = entry("Move");
    result.current.record(e);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    press({ key: "z", metaKey: true });
    expect(e.undo).not.toHaveBeenCalled();
  });

  it("stops listening when the host unmounts", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const hook = mount();
    expect(add.mock.calls.filter(([t]) => t === "keydown")).toHaveLength(1);
    hook.unmount();
    mounted.length = 0;
    expect(remove.mock.calls.filter(([t]) => t === "keydown")).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });
});
