// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import * as Y from "yjs";
import { addSlide } from "../deck-ops";
import { HtmlFrame, HtmlPrintFrame, HTML_DEBOUNCE_MS, HTML_SWAP_TIMEOUT_MS } from "../content-render";
import { addHtml } from "../freeform-ops";
import { reloadHtml } from "../html-reload";
import { initDeck } from "../model";
import { PAUSE_KEY, setCustomCodePaused } from "../pause-custom-code";
import { SlideRender } from "../SlideRender";
import { snapshotDeck } from "../snapshot";
import { themeById } from "../themes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  setCustomCodePaused(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function deck(source = "<p>hello</p>") {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  const id = addHtml(doc, slideId, source)!;
  const slide = () => snapshotDeck(doc).slides[0];
  return { doc, slideId, id, slide, element: () => slide().elements[0], placed: () => ({ x: 100, y: 50, w: 960, h: 540, rot: 0 }) };
}

const frame = () => container.querySelector("iframe")!;

describe("HtmlFrame", () => {
  it("runs the source in a sandbox with scripts only, no referrer, and the docs policy plus theme in srcdoc", () => {
    const d = deck("<script>1</script>");
    act(() => root.render(createElement(HtmlFrame, { element: d.element(), placed: d.placed(), theme: themeById("dali-dark") })));
    const f = frame();
    expect(f.getAttribute("sandbox")).toBe("allow-scripts");
    expect(f.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(f.getAttribute("referrerpolicy")).toBe("no-referrer");
    const srcdoc = f.getAttribute("srcdoc")!;
    expect(srcdoc).toContain("Content-Security-Policy");
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain("--slide-accent:#FF8B81");
    expect(srcdoc).toContain("--slide-font-display");
    expect(srcdoc).toContain("<script>1</script>");
    expect(f.hasAttribute("src")).toBe(false);
  });

  it("lays out at the element size in stage units and scales to the rendered width", () => {
    const d = deck();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(480);
    act(() => root.render(createElement(HtmlFrame, { element: d.element(), placed: d.placed(), theme: themeById("dali-dark") })));
    const f = frame();
    expect(f.style.width).toBe("960px");
    expect(f.style.height).toBe("540px");
    expect(f.style.transformOrigin).toBe("0 0");
    expect(f.style.transform).toBe("scale(0.5)");
  });

  it("lets pointer events through only when interactive", () => {
    const d = deck();
    const props = { element: d.element(), placed: d.placed(), theme: themeById("dali-dark") };
    act(() => root.render(createElement(HtmlFrame, { ...props, interactive: false })));
    expect(frame().style.pointerEvents).toBe("none");
    act(() => root.render(createElement(HtmlFrame, { ...props, interactive: true })));
    expect(frame().style.pointerEvents).toBe("auto");
  });

  it("does not pass a click inside it up to the stage", () => {
    const d = deck();
    const onStage = vi.fn();
    act(() =>
      root.render(createElement("div", { onClick: onStage }, createElement(HtmlFrame, { element: d.element(), placed: d.placed(), theme: themeById("dali-dark") }))),
    );
    act(() => void frame().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onStage).not.toHaveBeenCalled();
  });

  it("shows a placeholder instead of a frame while paused, and brings it back", () => {
    const d = deck();
    act(() => root.render(createElement(HtmlFrame, { element: d.element(), placed: d.placed(), theme: themeById("dali-dark") })));
    expect(frame()).toBeTruthy();
    act(() => setCustomCodePaused(true));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Custom code paused");
    expect(localStorage.getItem(PAUSE_KEY)).toBe("1");
    act(() => setCustomCodePaused(false));
    expect(frame()).toBeTruthy();
  });

  it("starts unpaused and survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const d = deck();
    act(() => root.render(createElement(HtmlFrame, { element: d.element(), placed: d.placed(), theme: themeById("dali-dark") })));
    expect(frame()).toBeTruthy();
    act(() => setCustomCodePaused(true));
    expect(container.querySelector("iframe")).toBeNull();
  });

  function edited(sources: string[]) {
    vi.useFakeTimers();
    const d = deck(sources[0]);
    const theme = themeById("dali-dark");
    const show = (html: string) => act(() => root.render(createElement(HtmlFrame, { element: { ...d.element(), html }, placed: d.placed(), theme })));
    show(sources[0]);
    for (const s of sources.slice(1)) {
      show(s);
      act(() => void vi.advanceTimersByTime(HTML_DEBOUNCE_MS + 1));
    }
  }
  const frames = () => [...container.querySelectorAll("iframe")];
  const pendingFrame = () => container.querySelector<HTMLIFrameElement>("iframe[data-html-pending]");
  const visibleFrame = () => container.querySelector<HTMLIFrameElement>("iframe:not([data-html-pending])")!;

  it("keeps the old page on screen while an edit loads behind it", () => {
    edited(["<p>one</p>", "<p>two</p>"]);
    expect(frames()).toHaveLength(2);
    expect(visibleFrame().getAttribute("srcdoc")).toContain("<p>one</p>");
    expect(visibleFrame().style.opacity).toBe("1");
    const next = pendingFrame()!;
    expect(next.getAttribute("srcdoc")).toContain("<p>two</p>");
    expect(next.style.opacity).toBe("0");
    expect(next.style.pointerEvents).toBe("none");
    expect(next.getAttribute("aria-hidden")).toBe("true");
  });

  it("swaps to the edit once it has loaded, keeping the same frame", () => {
    edited(["<p>one</p>", "<p>two</p>"]);
    const next = pendingFrame()!;
    act(() => void next.dispatchEvent(new Event("load")));
    expect(frames()).toEqual([next]);
    expect(next.hasAttribute("data-html-pending")).toBe(false);
    expect(next.style.opacity).toBe("1");
    expect(next.style.pointerEvents).toBe("auto");
  });

  it("swaps anyway when the edit never finishes loading", () => {
    edited(["<p>one</p>", "<p>two</p>"]);
    act(() => void vi.advanceTimersByTime(HTML_SWAP_TIMEOUT_MS + 1));
    expect(frames()).toHaveLength(1);
    expect(visibleFrame().getAttribute("srcdoc")).toContain("<p>two</p>");
  });

  it("replaces a waiting edit with a newer one instead of queueing both", () => {
    edited(["<p>one</p>", "<p>two</p>", "<p>three</p>"]);
    expect(frames()).toHaveLength(2);
    expect(visibleFrame().getAttribute("srcdoc")).toContain("<p>one</p>");
    expect(pendingFrame()!.getAttribute("srcdoc")).toContain("<p>three</p>");
  });

  it("does not load a second frame when the source is unchanged", () => {
    edited(["<p>one</p>", "<p>one</p>"]);
    expect(frames()).toHaveLength(1);
  });

  it("has square corners when it fills the slide and rounded ones otherwise", () => {
    const d = deck();
    const theme = themeById("dali-dark");
    const box = () => container.querySelector<HTMLElement>("[data-html-live]")!;
    act(() => root.render(createElement(HtmlFrame, { element: d.element(), placed: d.placed(), theme })));
    expect(box().style.borderRadius).not.toBe("0px");
    act(() => root.render(createElement(HtmlFrame, { element: { ...d.element(), htmlFill: true }, placed: d.placed(), theme })));
    expect(box().style.borderRadius).toBe("0px");
  });

  it("re-mounts the frame on reload", () => {
    const d = deck();
    act(() => root.render(createElement(HtmlFrame, { element: d.element(), placed: d.placed(), theme: themeById("dali-dark") })));
    const before = frame();
    act(() => reloadHtml(d.id));
    expect(frame()).not.toBe(before);
  });
});

describe("HtmlPrintFrame", () => {
  it("has square corners when it fills the slide", () => {
    const d = deck();
    const theme = themeById("dali-dark");
    const radius = (htmlFill?: true) =>
      renderToStaticMarkup(createElement(HtmlPrintFrame, { element: { ...d.element(), htmlFill }, placed: d.placed(), theme })).match(/border-radius:([^;"]+)/)![1];
    expect(radius(true)).toBe("0");
    expect(radius()).not.toBe("0");
  });
});

describe("SlideRender without a live renderer", () => {
  it("draws a static Custom HTML card, never a frame, for thumbnails and the grid", () => {
    const d = deck();
    const html = renderToStaticMarkup(createElement(SlideRender, { slide: d.slide(), theme: "dali-dark" }));
    expect(html).toContain('data-kind="html"');
    expect(html).toContain("Custom HTML");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("var(--slide-surface)");
  });

  it("lets a caller swap in the live frame", () => {
    const d = deck();
    act(() =>
      root.render(
        createElement(SlideRender, {
          slide: d.slide(),
          theme: "dali-dark",
          renderFree: ({ element, placed, fallback }) => (element.kind === "html" ? createElement(HtmlFrame, { element, placed, theme: themeById("dali-dark") }) : fallback),
        }),
      ),
    );
    expect(frame()).toBeTruthy();
  });
});
