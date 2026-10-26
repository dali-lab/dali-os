// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandPalette } from "../CommandPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => {};

let container: HTMLDivElement;
let root: Root;

function mount(extra: { onOpenInDesktop?: () => void; onOpen?: () => void } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(CommandPalette, { open: true, onClose: () => {}, tabless: false, focusMode: false, onOpen: () => {}, ...extra }),
    ),
  );
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const text = () => document.body.textContent ?? "";
const row = (title: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button[data-idx]")].find((b) => b.textContent?.includes(title));

describe("CommandPalette desktop commands", () => {
  it("omits both commands without the desktop callback", () => {
    mount();
    expect(text()).not.toContain("Open this page in the desktop app");
    expect(text()).not.toContain("Download the desktop app");
  });

  it("offers both commands with the callback", () => {
    mount({ onOpenInDesktop: () => {} });
    expect(row("Open this page in the desktop app")).toBeTruthy();
    expect(row("Download the desktop app")).toBeTruthy();
  });

  it("runs the open callback", () => {
    const onOpenInDesktop = vi.fn();
    mount({ onOpenInDesktop });
    act(() => row("Open this page in the desktop app")!.click());
    expect(onOpenInDesktop).toHaveBeenCalledTimes(1);
  });

  it("navigates to /download", () => {
    const onOpen = vi.fn();
    mount({ onOpenInDesktop: () => {}, onOpen });
    act(() => row("Download the desktop app")!.click());
    expect(onOpen).toHaveBeenCalledWith("/download", "Download", false);
  });
});
