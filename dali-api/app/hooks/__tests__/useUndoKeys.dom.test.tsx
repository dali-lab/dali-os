// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "~/components/drive/__tests__/render-hook";
import { useUndoKeys, type UndoKeyHistory } from "~/hooks/useUndoKeys";

const mounted: Array<() => void> = [];
afterEach(() => {
  mounted.splice(0).forEach((u) => u());
  document.body.innerHTML = "";
});

function history(over: Partial<UndoKeyHistory> = {}) {
  return { undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: true, ...over };
}

function mount(initial: UndoKeyHistory) {
  const hook = renderHook((h: UndoKeyHistory) => useUndoKeys(h), { initialProps: initial });
  mounted.push(hook.unmount);
  return hook;
}

function press(init: KeyboardEventInit & { key: string }, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(event));
  return event;
}

describe("useUndoKeys", () => {
  it("undoes on Cmd+Z and stops the browser's own handling", () => {
    const h = history();
    mount(h);
    const event = press({ key: "z", metaKey: true });
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.redo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ["Cmd+Shift+Z", { key: "z", metaKey: true, shiftKey: true }],
    ["Ctrl+Y", { key: "y", ctrlKey: true }],
  ])("redoes on %s", (_label, init) => {
    const h = history();
    mount(h);
    press(init);
    expect(h.redo).toHaveBeenCalledTimes(1);
    expect(h.undo).not.toHaveBeenCalled();
  });

  it("leaves the key to the browser when there is nothing to undo", () => {
    const h = history({ canUndo: false });
    mount(h);
    const event = press({ key: "z", metaKey: true });
    expect(h.undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("reads availability from a function", () => {
    const h = history({ canUndo: () => false, canRedo: () => true });
    mount(h);
    press({ key: "z", metaKey: true });
    press({ key: "z", metaKey: true, shiftKey: true });
    expect(h.undo).not.toHaveBeenCalled();
    expect(h.redo).toHaveBeenCalledTimes(1);
  });

  it("uses the latest history after a rerender", () => {
    const first = history({ canUndo: false });
    const hook = mount(first);
    const next = history();
    hook.rerender(next);
    press({ key: "z", metaKey: true });
    expect(first.undo).not.toHaveBeenCalled();
    expect(next.undo).toHaveBeenCalledTimes(1);
  });

  it("leaves the key to a text field being typed in", () => {
    const h = history();
    mount(h);
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = press({ key: "z", metaKey: true }, input);
    expect(h.undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing while a dialog is open", () => {
    const h = history();
    mount(h);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    press({ key: "z", metaKey: true });
    expect(h.undo).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const h = history();
    mount(h);
    mounted.splice(0).forEach((u) => u());
    press({ key: "z", metaKey: true });
    expect(h.undo).not.toHaveBeenCalled();
  });
});
