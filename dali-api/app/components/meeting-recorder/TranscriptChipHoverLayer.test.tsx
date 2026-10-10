// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { TranscriptChipHoverLayer } from "./TranscriptChipHoverLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

function chip(container: HTMLElement) {
  return container.querySelector('a[href*="?transcript="]') as HTMLAnchorElement;
}

function clickEvent(opts: Partial<MouseEventInit> = {}) {
  return new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...opts });
}

// `children` is a required prop on TranscriptChipHoverLayer, so it has to be
// passed inside the props object (not as createElement's vararg) for the
// overload that infers P to resolve.
function layer(
  props: { onChipClick?: (recordingId: string, at: number) => boolean; railOpen?: boolean },
  href = "/documents/p1?transcript=rec-1&at=42",
) {
  return createElement(TranscriptChipHoverLayer, {
    ...props,
    children: createElement("a", { href }, "12:04"),
  });
}

describe("TranscriptChipHoverLayer citation chip clicks", () => {
  it("intercepts a plain click on a transcript chip when onChipClick handles it", () => {
    const onChipClick = vi.fn(() => true);
    const { container, unmount } = mount(layer({ onChipClick }));
    const anchor = chip(container);
    const event = clickEvent();
    act(() => anchor.dispatchEvent(event));

    expect(onChipClick).toHaveBeenCalledWith("rec-1", 42);
    expect(event.defaultPrevented).toBe(true);
    unmount();
  });

  it("lets default navigation proceed when onChipClick returns false", () => {
    const onChipClick = vi.fn(() => false);
    const { container, unmount } = mount(layer({ onChipClick }, "/documents/p1?transcript=rec-2&at=5"));
    const anchor = chip(container);
    const event = clickEvent();
    act(() => anchor.dispatchEvent(event));

    expect(onChipClick).toHaveBeenCalledWith("rec-2", 5);
    expect(event.defaultPrevented).toBe(false);
    unmount();
  });

  it("falls through on a modifier click without calling onChipClick", () => {
    const onChipClick = vi.fn(() => true);
    const { container, unmount } = mount(layer({ onChipClick }));
    const anchor = chip(container);
    const metaClick = clickEvent({ metaKey: true });
    act(() => anchor.dispatchEvent(metaClick));

    expect(onChipClick).not.toHaveBeenCalled();
    expect(metaClick.defaultPrevented).toBe(false);
    unmount();
  });

  it("falls through on a middle click without calling onChipClick", () => {
    const onChipClick = vi.fn(() => true);
    const { container, unmount } = mount(layer({ onChipClick }));
    const anchor = chip(container);
    const middleClick = clickEvent({ button: 1 });
    act(() => anchor.dispatchEvent(middleClick));

    expect(onChipClick).not.toHaveBeenCalled();
    expect(middleClick.defaultPrevented).toBe(false);
    unmount();
  });

  it("Enter on a focused chip does the same as a plain click", () => {
    const onChipClick = vi.fn(() => true);
    const { container, unmount } = mount(layer({ onChipClick }));
    const anchor = chip(container);
    anchor.focus();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => anchor.dispatchEvent(event));

    expect(onChipClick).toHaveBeenCalledWith("rec-1", 42);
    expect(event.defaultPrevented).toBe(true);
    unmount();
  });

  it("returns focus to the chip once the rail closes again", () => {
    const onChipClick = vi.fn(() => true);
    const { container, rerender, unmount } = mount(layer({ onChipClick, railOpen: false }));
    const anchor = chip(container);
    act(() => anchor.dispatchEvent(clickEvent()));

    rerender(layer({ onChipClick, railOpen: true }));
    anchor.blur();
    rerender(layer({ onChipClick, railOpen: false }));

    expect(document.activeElement).toBe(chip(container));
    unmount();
  });
});
