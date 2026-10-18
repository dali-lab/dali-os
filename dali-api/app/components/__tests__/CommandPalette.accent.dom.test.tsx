// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandPalette } from "../CommandPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => {};

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CommandPalette highlight", () => {
  it("marks the active row with the os accent and never brand coral", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(CommandPalette, { open: true, onClose: () => {} })));

    const rows = document.body.querySelectorAll("button[data-idx]");
    expect(rows.length).toBeGreaterThan(0);
    const active = document.body.querySelector('button[data-idx="0"]')!;
    expect(active.className).toContain("bg-os-accent/15");
    expect(document.body.innerHTML).not.toContain("accent-coral");
  });
});
