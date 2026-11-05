// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandPalette } from "../CommandPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => {};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ results: [] })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mount(extra: { onAsk?: (q: string) => void; onClose?: () => void } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(CommandPalette, { open: true, onClose: () => {}, focusMode: false, onOpen: () => {}, ...extra }),
    ),
  );
}

function type(value: string) {
  const input = document.body.querySelector<HTMLInputElement>("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

const rows = () => [...document.body.querySelectorAll<HTMLButtonElement>("button[data-idx]")];
const askRow = () => rows().find((b) => b.textContent?.includes("Ask DALI"));

describe("CommandPalette Ask row", () => {
  it("isn't offered without Ask", () => {
    mount();
    type("What did we decide about the launch?");
    expect(askRow()).toBeUndefined();
  });

  it("waits for at least two characters", () => {
    mount({ onAsk: () => {} });
    type("w");
    expect(askRow()).toBeUndefined();
  });

  it("goes first and selected when the text reads like a question", () => {
    mount({ onAsk: () => {} });
    type("What did we decide about the launch?");
    expect(rows()[0]).toBe(askRow());
    expect(askRow()!.className).toContain("bg-os-accent/15");
  });

  it("goes last for a plain search, so Enter still opens the top result", () => {
    mount({ onAsk: () => {} });
    type("help");
    expect(rows().length).toBeGreaterThan(1);
    expect(rows().at(-1)).toBe(askRow());
  });

  it("asks the typed text and closes the palette", () => {
    const onAsk = vi.fn();
    const onClose = vi.fn();
    mount({ onAsk, onClose });
    const input = type("  Who runs the design team?  ");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onAsk).toHaveBeenCalledWith("Who runs the design team?");
    expect(onClose).toHaveBeenCalled();
  });
});
