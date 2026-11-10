// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PresentStage } from "../PresentStage";
import { PresenterView, formatElapsed } from "../PresenterView";
import { FollowChip } from "../FollowChip";
import { navActionFor, nextIndex } from "../keys";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  constructor(private cb: () => void) {}
  observe() {
    this.cb();
  }
  disconnect() {}
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 1600 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 900 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP;
});

const ids = ["a", "b", "c"];
const render = vi.fn((id: string, opts: { width: number }) => createElement("div", { "data-slide": id, "data-width": opts.width }, id));
const key = (k: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

function Harness({ children, start = 0 }: { children: (p: { index: number; set: (i: number) => void }) => React.ReactNode; start?: number }) {
  const [index, set] = useState(start);
  return createElement("div", null, children({ index, set }), createElement("output", { "data-testid": "idx" }, index));
}
const idx = () => container.querySelector("output")!.textContent;

describe("key helpers", () => {
  it("maps keys to actions and clamps indexes", () => {
    expect(["ArrowRight", " ", "PageDown", "ArrowLeft", "PageUp", "Home", "End", "Escape", "x"].map(navActionFor)).toEqual([
      "next", "next", "next", "prev", "prev", "first", "last", "exit", null,
    ]);
    expect(nextIndex("next", 2, 3)).toBe(2);
    expect(nextIndex("prev", 0, 3)).toBe(0);
    expect(nextIndex("last", 0, 3)).toBe(2);
  });
});

describe("PresentStage", () => {
  const mount = (onExit?: () => void) =>
    act(() =>
      root.render(
        createElement(Harness, {
          children: ({ index, set }) => createElement(PresentStage, { slideIds: ids, index, onIndexChange: set, renderSlide: render, onExit }),
        }),
      ),
    );

  it("renders the current slide via renderSlide with a 16:9 width", () => {
    mount();
    expect(render).toHaveBeenCalledWith("a", { width: 1600 });
    expect(container.querySelector("[data-slide=a]")).not.toBeNull();
  });

  it("navigates with the keyboard and stays in range", () => {
    mount();
    key("ArrowRight");
    key(" ");
    key("PageDown");
    expect(idx()).toBe("2");
    key("PageUp");
    expect(idx()).toBe("1");
    key("Home");
    expect(idx()).toBe("0");
    key("End");
    expect(idx()).toBe("2");
    key("ArrowLeft");
    expect(idx()).toBe("1");
  });

  it("advances on click and exits on Escape", () => {
    const onExit = vi.fn();
    mount(onExit);
    act(() => void (container.querySelector("[data-testid=present-slide]") as HTMLElement).click());
    expect(idx()).toBe("1");
    key("Escape");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("shows the full screen hint in the desktop app and a full screen button when supported in a browser", () => {
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    mount();
    expect(container.textContent).toContain("Press ⌃⌘F for full screen");
    expect(container.querySelector("[aria-label='Full screen']")).toBeNull();
  });

  it("offers element fullscreen in a browser", () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const request = vi.fn(async () => {});
    HTMLElement.prototype.requestFullscreen = request;
    mount();
    expect(container.textContent).not.toContain("⌃⌘F");
    act(() => void (container.querySelector("[aria-label='Full screen']") as HTMLElement).click());
    expect(request).toHaveBeenCalled();
  });
});

describe("PresenterView", () => {
  const mount = (extra: Record<string, unknown> = {}, onEnd = vi.fn()) =>
    act(() =>
      root.render(
        createElement(Harness, {
          start: 1,
          children: ({ index, set }) =>
            createElement(PresenterView, {
              title: "Demo day",
              slideIds: ids,
              notes: { a: "first notes", b: "second notes" },
              index,
              onIndexChange: set,
              renderSlide: render,
              onEnd,
              ...extra,
            }),
        }),
      ),
    );
  const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

  it("shows title, position, notes, and renders now, next, and filmstrip slides", () => {
    mount();
    expect(container.textContent).toContain("Demo day");
    expect(container.textContent).toContain("Slide 2 of 3");
    expect(container.querySelector("[data-testid=notes]")!.textContent).toBe("second notes");
    expect(container.querySelectorAll("[data-testid=filmstrip] button")).toHaveLength(3);
    expect(render.mock.calls.filter(([id]) => id === "c").length).toBeGreaterThan(0);
  });

  it("moves with Back, Next slide, filmstrip and keys", () => {
    mount();
    act(() => button("Back").click());
    expect(idx()).toBe("0");
    expect(button("Back").disabled).toBe(true);
    act(() => button("Next slide").click());
    act(() => (container.querySelector("[aria-label='Go to slide 3']") as HTMLElement).click());
    expect(idx()).toBe("2");
    expect(button("Next slide").disabled).toBe(true);
    expect(container.textContent).toContain("End of deck");
    key("ArrowLeft");
    expect(idx()).toBe("1");
  });

  it("calls onEnd, and resizes notes within bounds", () => {
    const onEnd = vi.fn();
    mount({}, onEnd);
    act(() => button("End").click());
    expect(onEnd).toHaveBeenCalled();
    const notes = container.querySelector<HTMLElement>("[data-testid=notes]")!;
    act(() => (container.querySelector("[aria-label='Larger notes']") as HTMLElement).click());
    expect(notes.style.fontSize).toBe("18px");
    for (let i = 0; i < 10; i++) act(() => (container.querySelector("[aria-label='Smaller notes']") as HTMLElement).click());
    expect(notes.style.fontSize).toBe("12px");
  });

  it("shows the follower count and copies the link only when provided", async () => {
    mount();
    expect(container.textContent).not.toContain("following");
    expect(button("Copy link")).toBeUndefined();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mount({ followerCount: 18, shareUrl: "https://x/slides/p1" });
    expect(container.textContent).toContain("18 following");
    await act(async () => button("Copy link").click());
    expect(writeText).toHaveBeenCalledWith("https://x/slides/p1");
  });

  it("formats elapsed time", () => {
    expect(formatElapsed(3_723_000)).toBe("01:02:03");
    expect(formatElapsed(-5)).toBe("00:00:00");
  });
});

describe("FollowChip", () => {
  it("names the presenter and slide and offers Browse on my own", () => {
    const onBrowse = vi.fn();
    act(() => root.render(createElement(FollowChip, { presenterName: "Ada", index: 1, total: 6, onBrowse })));
    expect(container.textContent).toContain("Following Ada · Slide 2 of 6");
    act(() => (container.querySelector("button") as HTMLElement).click());
    expect(onBrowse).toHaveBeenCalled();
    expect(container.querySelector("button")!.textContent).toBe("Browse on my own");
  });
});
