// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import * as Y from "yjs";
import { addSlide } from "../deck-ops";
import { addChart, addCodeBlock, addIcon, addTable, addVideo, setChart } from "../freeform-ops";
import { PlayableVideo } from "../content-render";
import { initDeck } from "../model";
import { SlideRender } from "../SlideRender";
import { snapshotDeck } from "../snapshot";
import { THEMES } from "../themes";

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
});

const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function deck() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  return { doc, slideId, slide: () => snapshotDeck(doc).slides[0] };
}

describe("SlideRender content elements", () => {
  it("draws a bar chart with one bar per value, in theme colors", () => {
    const { doc, slideId, slide } = deck();
    addChart(doc, slideId, "bar");
    act(() => root.render(createElement(SlideRender, { slide: slide(), theme: "dali-dark" })));
    const svg = container.querySelector("svg[data-chart=bar]")!;
    expect(svg.querySelectorAll("[data-bar]")).toHaveLength(4);
    expect(svg.getAttribute("viewBox")).toBe("0 0 960 540");
    const fills = [...svg.querySelectorAll("[data-bar]")].map((n) => (n as SVGElement).style.fill);
    expect(fills.every((f) => f.includes("accent") || f.includes("--"))).toBe(true);
    expect(svg.outerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("draws line and pie charts, and a legend for several series", () => {
    const { doc, slideId, slide } = deck();
    const id = addChart(doc, slideId, "line")!;
    setChart(doc, slideId, id, { type: "line", data: { labels: ["A", "B"], series: [{ name: "One", values: [1, 2] }, { name: "Two", values: [3, 1] }] } });
    act(() => root.render(createElement(SlideRender, { slide: slide(), theme: "dali-light" })));
    expect(container.querySelectorAll("[data-line]")).toHaveLength(2);
    expect(container.querySelector("[data-chart-legend]")!.textContent).toContain("Two");
    setChart(doc, slideId, id, { type: "pie", data: { labels: ["A", "B", "C"], series: [{ name: "S", values: [1, 1, 2] }] } });
    act(() => root.render(createElement(SlideRender, { slide: slide(), theme: "dali-light" })));
    expect(container.querySelectorAll("[data-slice]")).toHaveLength(3);
    expect(container.querySelector("[data-chart-legend]")!.textContent).toContain("C 50%");
  });

  it("draws an icon from the set in the chosen fill", () => {
    const { doc, slideId, slide } = deck();
    addIcon(doc, slideId, "rocket");
    act(() => root.render(createElement(SlideRender, { slide: slide(), theme: "dali-dark" })));
    const box = container.querySelector<HTMLElement>("[data-icon=rocket]")!;
    expect(box.style.color).toBe("var(--slide-accent)");
    expect(box.querySelector("svg")).not.toBeNull();
  });

  it("draws a video poster that names its provider and loads no player", () => {
    const { doc, slideId, slide } = deck();
    addVideo(doc, slideId, YT);
    act(() => root.render(createElement(SlideRender, { slide: slide(), theme: "dali-dark" })));
    expect(container.querySelector("[data-kind=video]")!.textContent).toContain("YouTube video");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("draws tables with a header row and code blocks on the theme surface", () => {
    const { doc, slideId, slide } = deck();
    addTable(doc, slideId, undefined, 3, 2);
    addCodeBlock(doc, slideId);
    act(() => root.render(createElement(SlideRender, { slide: slide(), theme: "dali-dark" })));
    const table = container.querySelector("[data-slide-table]")!;
    expect(table.querySelectorAll("tr")).toHaveLength(3);
    expect(table.querySelectorAll("th")).toHaveLength(2);
    expect(table.querySelectorAll("td")).toHaveLength(4);
    expect((table.querySelector("th") as HTMLElement).style.background).toBe("var(--slide-surface)");
    expect((container.querySelector("pre") as HTMLElement).style.background).toBe("var(--slide-surface)");
  });

  it("renders to static markup without hooks, as the PDF export does", () => {
    const { doc, slideId, slide } = deck();
    addChart(doc, slideId, "bar");
    addChart(doc, slideId, "pie");
    addIcon(doc, slideId, "star");
    addVideo(doc, slideId, YT);
    addTable(doc, slideId);
    for (const theme of THEMES) {
      const html = renderToStaticMarkup(SlideRender({ slide: slide(), theme: theme.id }));
      expect(html).toContain('data-chart="bar"');
      expect(html).toContain('data-chart="pie"');
      expect(html).toContain('data-icon="star"');
      expect(html).toContain("YouTube video");
      expect(html).toContain("data-slide-table");
    }
  });

  it("hides a chart before its build step", () => {
    const { doc, slideId } = deck();
    const id = addChart(doc, slideId)!;
    const s = { ...snapshotDeck(doc).slides[0] };
    s.elements = s.elements.map((e) => (e.id === id ? { ...e, build: 2 } : e));
    act(() => root.render(createElement(SlideRender, { slide: s, theme: "dali-dark", step: 1 })));
    expect(container.querySelector("[data-chart]")).toBeNull();
    act(() => root.render(createElement(SlideRender, { slide: s, theme: "dali-dark", step: 2 })));
    expect(container.querySelector("[data-chart]")).not.toBeNull();
  });
});

describe("PlayableVideo", () => {
  it("shows the poster until clicked, then plays the registry's player without advancing the slide", () => {
    const { doc, slideId, slide } = deck();
    addVideo(doc, slideId, YT);
    const element = slide().elements[0];
    let parentClicks = 0;
    act(() => root.render(createElement("div", { onClick: () => parentClicks++ }, createElement(PlayableVideo, { element, placed: { x: 0, y: 0, w: 960, h: 540, rot: 0 } }))));
    expect(container.querySelector("iframe")).toBeNull();
    act(() => void container.querySelector<HTMLElement>("[data-play-video]")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
    expect(parentClicks).toBe(0);
  });

  it("falls back to the poster for a link the registry does not know", () => {
    const { doc, slideId, slide } = deck();
    addVideo(doc, slideId, YT);
    const element = { ...slide().elements[0], videoUrl: "https://example.com/x" };
    act(() => root.render(createElement(PlayableVideo, { element, placed: { x: 0, y: 0, w: 960, h: 540, rot: 0 } })));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[data-play-video]")).toBeNull();
  });
});
