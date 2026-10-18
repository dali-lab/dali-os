// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement, act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { TranscriptChipHoverLayer, clearChipRecordingCache } from "./TranscriptChipHoverLayer";

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

describe("TranscriptChipHoverLayer hover card", () => {
  const recording = {
    lines: [
      { at: 842, end: 850, text: "We're eleven behind.", channel: "call", speaker: "call:1" },
      { at: 900, end: 905, text: "Other line", channel: "call", speaker: "call:2" },
    ],
    speakers: { "call:1": "u1" },
    speakerNames: { "call:1": "Maya Chen" },
  };

  beforeEach(() => {
    clearChipRecordingCache();
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => recording })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function hoverChip(container: HTMLElement) {
    const anchor = chip(container);
    await act(async () => {
      anchor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(300);
    });
  }

  const card = () => document.querySelector('[aria-label="Transcript quote"]') as HTMLElement | null;

  it("shows who said the cited line, when, and the quote", async () => {
    const { container, unmount } = mount(layer({}, "/documents/p1?transcript=rec-1&at=843"));
    await hoverChip(container);
    expect(card()!.textContent).toContain("Maya Chen");
    expect(card()!.textContent).toContain("14:02");
    expect(card()!.textContent).toContain("“We're eleven behind.”");
    expect(card()!.textContent).toContain("Open in transcript");
    unmount();
  });

  it("falls back to the channel label while the speaker is unnamed", async () => {
    const { container, unmount } = mount(layer({}, "/documents/p1?transcript=rec-1&at=903"));
    await hoverChip(container);
    expect(card()!.textContent).toContain("Speaker 2");
    unmount();
  });

  it("Open in transcript hands the chip's recording and second to onChipClick and closes", async () => {
    const onChipClick = vi.fn(() => true);
    const { container, unmount } = mount(layer({ onChipClick }, "/documents/p1?transcript=rec-1&at=843"));
    await hoverChip(container);
    const open = [...card()!.querySelectorAll("button")].find((b) => b.textContent === "Open in transcript")!;
    act(() => open.click());
    expect(onChipClick).toHaveBeenCalledWith("rec-1", 843);
    expect(card()).toBeNull();
    unmount();
  });

  it("stays open while the pointer moves from the chip onto the card", async () => {
    const { container, unmount } = mount(layer({}));
    await hoverChip(container);
    await act(async () => {
      chip(container).dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: card() }));
      card()!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      card()!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(card()).not.toBeNull();
    unmount();
  });

  it("closes shortly after the pointer leaves the chip", async () => {
    const { container, unmount } = mount(layer({}));
    await hoverChip(container);
    await act(async () => {
      chip(container).dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(card()).toBeNull();
    unmount();
  });
});
