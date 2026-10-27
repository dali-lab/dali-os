// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useToggleSidebarShortcut } from "~/components/shell/useToggleSidebarShortcut";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toggle = vi.fn();
let root: Root;
let container: HTMLDivElement;

function Probe({ enabled }: { enabled: boolean }) {
  useToggleSidebarShortcut(enabled, toggle);
  return null;
}

function mount(enabled = true) {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<Probe enabled={enabled} />));
}

function press(init: KeyboardEventInit, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  act(() => root.unmount());
  toggle.mockClear();
  document.body.innerHTML = "";
});

describe("useToggleSidebarShortcut", () => {
  it("toggles on cmd+backslash and ctrl+backslash", () => {
    mount();
    expect(press({ key: "\\", metaKey: true }).defaultPrevented).toBe(true);
    press({ key: "\\", ctrlKey: true });
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("works while typing in a field", () => {
    mount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    press({ key: "\\", metaKey: true }, input);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("ignores partial combos", () => {
    mount();
    press({ key: "\\" });
    press({ key: "k", metaKey: true });
    press({ key: "\\", metaKey: true, shiftKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    mount(false);
    press({ key: "\\", metaKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });

  it("skips an event another handler already claimed", () => {
    mount();
    const claim = (e: Event) => e.preventDefault();
    document.addEventListener("keydown", claim);
    press({ key: "\\", metaKey: true });
    document.removeEventListener("keydown", claim);
    expect(toggle).not.toHaveBeenCalled();
  });
});
