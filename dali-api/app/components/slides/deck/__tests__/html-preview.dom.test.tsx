// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HtmlPreview } from "../content-render";
import { HTML_PREVIEW_SETTLE_MS, HtmlPreviewContext, htmlPreviewVersion } from "../html-preview";
import { SlideRender } from "../SlideRender";
import { themeById } from "../themes";
import type { RenderElement, RenderSlide } from "../snapshot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const theme = themeById("dali-dark");
const placed = { x: 100, y: 50, w: 960, h: 540, rot: 0 };
const element = (html = "<p>hi</p>"): RenderElement => ({ id: "e1", kind: "html", slot: null, z: 1, blocks: [], html, ...placed }) as unknown as RenderElement;
const versionOf = (html: string) => htmlPreviewVersion(html, theme.id, { w: 960, h: 540 });

const inDeck = (node: ReactNode) => createElement(HtmlPreviewContext.Provider, { value: { pageId: "p1" } }, node);
const draw = (html: string, wrap = true) => {
  const node = createElement(HtmlPreview, { placed, element: element(html), theme });
  act(() => root.render(wrap ? inDeck(node) : node));
};
const img = () => container.querySelector<HTMLImageElement>("img[data-html-preview]");
const card = () => container.textContent?.includes("Custom HTML");

describe("HtmlPreview", () => {
  it("shows only the placeholder card outside a deck", () => {
    draw("<p>hi</p>", false);
    expect(img()).toBeNull();
    expect(card()).toBe(true);
  });

  it("asks for the element's picture by version, hidden on the card until it loads", () => {
    draw("<p>hi</p>");
    expect(img()!.getAttribute("src")).toBe(`/slides/p1/html-preview/e1?v=${versionOf("<p>hi</p>")}`);
    expect(img()!.getAttribute("loading")).toBe("lazy");
    expect(img()!.style.opacity).toBe("0");
    expect(card()).toBe(true);
  });

  it("replaces the card with the picture once it loads, keeping the element's data key", () => {
    draw("<p>hi</p>");
    act(() => img()!.dispatchEvent(new Event("load")));
    expect(img()!.style.opacity).toBe("1");
    expect(card()).toBe(false);
    const box = container.querySelector('[data-element="e1"]')!;
    expect(box.getAttribute("data-kind")).toBe("html");
    expect(box.contains(img())).toBe(true);
  });

  it("goes back to the card when the picture fails", () => {
    draw("<p>hi</p>");
    act(() => img()!.dispatchEvent(new Event("error")));
    expect(img()).toBeNull();
    expect(card()).toBe(true);
  });

  it("keeps the last picture while edits settle, then asks for the new version", () => {
    vi.useFakeTimers();
    draw("<p>hi</p>");
    act(() => img()!.dispatchEvent(new Event("load")));
    draw("<p>h</p>");
    draw("<p>bye</p>");
    act(() => vi.advanceTimersByTime(HTML_PREVIEW_SETTLE_MS - 1));
    expect(img()!.getAttribute("src")).toContain(versionOf("<p>hi</p>"));
    act(() => vi.advanceTimersByTime(1));
    expect(img()!.getAttribute("src")).toContain(versionOf("<p>bye</p>"));
    expect(img()!.style.opacity).toBe("1");
  });
});

describe("SlideRender", () => {
  it("draws a free HTML element as its picture inside a deck", () => {
    const slide = { id: "s1", pos: 0, layoutId: "blank", elements: [element()] } as unknown as RenderSlide;
    act(() => root.render(inDeck(createElement(SlideRender, { slide, theme: "dali-dark" }))));
    expect(img()!.getAttribute("src")).toContain("/slides/p1/html-preview/e1");
  });
});
