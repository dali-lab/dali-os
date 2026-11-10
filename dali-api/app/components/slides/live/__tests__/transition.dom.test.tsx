// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SlideRender } from "~/components/slides/deck/SlideRender";
import type { RenderElement, RenderSlide } from "~/components/slides/deck/snapshot";
import type { SlideTransition } from "~/components/slides/deck/slide-meta";
import { SlideTransitionStage } from "../SlideTransitionStage";
import { PresentStage } from "../PresentStage";

vi.mock("../transition.css", () => ({}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const el = (id: string, extra: Partial<RenderElement> = {}): RenderElement => ({ id, kind: "shape", slot: null, z: 1, blocks: [], src: null, alt: null, textStyle: null, x: 100, y: 100, w: 200, h: 200, shape: "rect", fill: "accent", ...extra });
const slide = (id: string, elements: RenderElement[], transition?: SlideTransition): RenderSlide => ({ id, pos: 0, layoutId: "blank", elements, ...(transition ? { transition } : {}) });

let container: HTMLDivElement;
let root: Root;
const reduced = (on: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  reduced(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const renderSlide = (slides: RenderSlide[]) => (id: string) => createElement(SlideRender, { slide: slides.find((s) => s.id === id)!, theme: "dali-dark" });
const draw = (slides: RenderSlide[], slideId: string) =>
  act(() => root.render(createElement(SlideTransitionStage, { slides, themeId: "dali-dark", slideId, width: 960, renderSlide: renderSlide(slides) })));
const tick = (ms: number) => {
  for (let t = 0; t < ms; t += 20) act(() => void vi.advanceTimersByTime(20));
};
const layers = () => [...container.querySelectorAll("[data-transition-layer]")].map((n) => n.getAttribute("data-transition-layer"));

describe("SlideTransitionStage", () => {
  it("draws the first slide with no animation", () => {
    const slides = [slide("a", [el("x")]), slide("b", [el("x")], { kind: "dissolve" })];
    draw(slides, "a");
    expect(container.querySelector("[data-transition]")).toBeNull();
    expect(container.querySelector('[data-element="x"]')).not.toBeNull();
  });

  it("dissolves from the old slide to the new one, then leaves only the new one", () => {
    const slides = [slide("a", [el("old")]), slide("b", [el("new")], { kind: "dissolve", duration: 300 })];
    draw(slides, "a");
    draw(slides, "b");
    expect(container.querySelector("[data-transition=dissolve]")).not.toBeNull();
    expect(layers()).toEqual(["in", "out"]);
    const out = container.querySelector<HTMLElement>("[data-transition-layer=out]")!;
    expect(out.style.opacity).toBe("1");
    expect(out.querySelector('[data-element="old"]')).not.toBeNull();
    tick(40);
    expect(container.querySelector<HTMLElement>("[data-transition-layer=out]")!.style.opacity).toBe("0");
    tick(400);
    expect(container.querySelector("[data-transition]")).toBeNull();
    expect(container.querySelector('[data-element="new"]')).not.toBeNull();
    expect(container.querySelector('[data-element="old"]')).toBeNull();
  });

  it("pushes the old slide out the way it came, and the other way going back", () => {
    const slides = [slide("a", [el("old")]), slide("b", [el("new")], { kind: "push", duration: 300 })];
    draw(slides, "a");
    draw(slides, "b");
    expect(container.querySelector<HTMLElement>("[data-transition-layer=in]")!.style.transform).toBe("translateX(100%)");
    tick(40);
    expect(container.querySelector<HTMLElement>("[data-transition-layer=out]")!.style.transform).toBe("translateX(-100%)");
    tick(400);
    const back = [slide("a", [el("old")], { kind: "push", duration: 300 }), slide("b", [el("new")])];
    draw(back, "b");
    draw(back, "a");
    expect(container.querySelector<HTMLElement>("[data-transition-layer=in]")!.style.transform).toBe("translateX(-100%)");
  });

  it("magic move starts matched elements where they were and fades the rest", () => {
    const from = slide("a", [el("x", { x: 10, y: 20, w: 30, h: 40 }), el("gone")]);
    const to = slide("b", [el("x", { x: 500, y: 300, w: 90, h: 90 }), el("fresh", { x: 900 })], { kind: "magic", duration: 600 });
    const slides = [from, to];
    draw(slides, "a");
    draw(slides, "b");
    const stage = container.querySelector('[data-transition=magic]')!;
    const moving = stage.querySelector<HTMLElement>('[data-slide-morph] [data-element="x"]')!;
    expect(moving.style.left).toBe("calc(10 * var(--slide-u))");
    expect(stage.querySelector("[data-slide-morph] style")!.textContent).toContain('[data-element="fresh"],[data-slot="fresh"]{opacity:0!important}');
    const outgoing = stage.querySelector("[data-transition-layer=out]")!;
    expect(outgoing.querySelector("style")!.textContent).toContain('[data-element="x"]');
    expect(outgoing.textContent).not.toContain("fresh");
    tick(40);
    const arrived = container.querySelector<HTMLElement>('[data-slide-morph] [data-element="x"]')!;
    expect(arrived.style.left).toBe("calc(500 * var(--slide-u))");
    expect(container.querySelector("[data-slide-morph] style")).toBeNull();
    expect(container.querySelector<HTMLElement>("[data-transition-layer=out]")!.style.opacity).toBe("0");
    tick(700);
    expect(container.querySelector("[data-transition]")).toBeNull();
  });

  it("plays nothing when the viewer prefers reduced motion", () => {
    reduced(true);
    const slides = [slide("a", [el("old")]), slide("b", [el("new")], { kind: "magic" })];
    draw(slides, "a");
    draw(slides, "b");
    expect(container.querySelector("[data-transition]")).toBeNull();
    expect(container.querySelector('[data-element="new"]')).not.toBeNull();
  });

  it("plays nothing for a slide with no transition or one set to none", () => {
    const slides = [slide("a", [el("old")]), slide("b", [el("new")])];
    draw(slides, "a");
    draw(slides, "b");
    expect(container.querySelector("[data-transition]")).toBeNull();
  });

  it("does not replay when only the build step changes", () => {
    const slides = [slide("a", [el("old")]), slide("b", [el("new")], { kind: "dissolve" })];
    draw(slides, "a");
    draw(slides, "b");
    tick(700);
    act(() => root.render(createElement(SlideTransitionStage, { slides, themeId: "dali-dark", slideId: "b", step: 1, width: 960, renderSlide: renderSlide(slides) })));
    expect(container.querySelector("[data-transition]")).toBeNull();
  });
});

describe("PresentStage transitions", () => {
  it("uses transitions only when given the deck", () => {
    const slides = [slide("a", [el("old")]), slide("b", [el("new")], { kind: "dissolve" })];
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 960 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 540 });
    const props = (index: number, transitions?: object) => ({ slideIds: ["a", "b"], index, onIndexChange: () => {}, renderSlide: renderSlide(slides), transitions });
    act(() => root.render(createElement(PresentStage, props(0, { slides, themeId: "dali-dark" }) as never)));
    act(() => root.render(createElement(PresentStage, props(1, { slides, themeId: "dali-dark" }) as never)));
    expect(container.querySelector("[data-transition=dissolve]")).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(createElement(PresentStage, props(0) as never)));
    act(() => root.render(createElement(PresentStage, props(1) as never)));
    expect(container.querySelector("[data-transition]")).toBeNull();
  });
});
