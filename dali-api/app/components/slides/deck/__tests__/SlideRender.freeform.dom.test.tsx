// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { blocksToFragment } from "~/collab/blocknote-server";
import { renderToStaticMarkup } from "react-dom/server";
import { toRenderDeck, readDeck } from "~/collab/read-deck.server";
import { addSlide, slideFragment } from "../deck-ops";
import { addFreeImage, setCrop, addShape, addTextBox, groupElements, moveElements, reorderElements, setPlacements } from "../freeform-ops";
import { SlideRender, type SlideRenderProps } from "../SlideRender";
import { initDeck, elementsOf, slidesMap } from "../model";
import { snapshotDeck } from "../snapshot";

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
const render = (props: SlideRenderProps) => {
  act(() => root.render(createElement(SlideRender, props)));
  return container.querySelector<HTMLElement>("[data-slide-stage]")!;
};

function deck(layout = "blank") {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, layout, null);
  return { doc, slideId, slide: () => snapshotDeck(doc).slides[0] };
}
const style = (n: Element | null) => (n as HTMLElement).style;

describe("SlideRender free elements", () => {
  it("draws nothing for the blank layout", () => {
    const { slide } = deck();
    const stage = render({ slide: slide(), theme: "dali-dark", placeholders: true });
    expect(stage.querySelectorAll("[data-element], [data-slot]")).toHaveLength(0);
  });

  it("places a free text box, shape and image at their geometry with rotation", () => {
    const { doc, slideId, slide } = deck();
    const t = addTextBox(doc, slideId, { x: 960, y: 540 })!;
    blocksToFragment([{ type: "paragraph", content: "Free words" }] as never, slideFragment(doc, slideId, t)!);
    const r = addShape(doc, slideId, "rect")!;
    setPlacements(doc, slideId, { [r]: { x: 100, y: 200, w: 300, h: 150, rot: 15 } });
    const i = addFreeImage(doc, slideId, "https://x/y.png", "pic", { width: 400, height: 300 })!;
    const stage = render({ slide: slide(), theme: "dali-dark" });
    const text = stage.querySelector(`[data-element="${t}"]`)!;
    expect(text.textContent).toContain("Free words");
    const shape = stage.querySelector(`[data-element="${r}"]`)!;
    expect(shape.getAttribute("data-shape")).toBe("rect");
    expect(style(shape).left).toBe("calc(100 * var(--slide-u))");
    expect(style(shape).width).toBe("calc(300 * var(--slide-u))");
    expect(style(shape).transform).toBe("rotate(15deg)");
    expect(style(shape).background).toContain("--slide-accent");
    const img = stage.querySelector(`img[data-element="${i}"]`)!;
    expect(img.getAttribute("src")).toBe("https://x/y.png");
    expect(img.getAttribute("alt")).toBe("pic");
  });

  it("draws by z order, so sending a shape back puts it behind another", () => {
    const { doc, slideId, slide } = deck();
    const a = addShape(doc, slideId, "rect")!;
    const b = addShape(doc, slideId, "ellipse")!;
    const order = () => [...render({ slide: slide(), theme: "dali-dark" }).querySelectorAll("[data-element]")].map((n) => n.getAttribute("data-element"));
    expect(order()).toEqual([a, b]);
    reorderElements(doc, slideId, [b], "back");
    expect(order()).toEqual([b, a]);
  });

  it("draws lines and arrows as svg and uses the chosen theme fill", () => {
    const { doc, slideId, slide } = deck();
    const l = addShape(doc, slideId, "line")!;
    const a = addShape(doc, slideId, "arrow")!;
    const stage = render({ slide: slide(), theme: "dali-light" });
    expect(stage.querySelector(`svg[data-element="${l}"] rect`)).not.toBeNull();
    expect(stage.querySelector(`svg[data-element="${a}"] polygon`)).not.toBeNull();
  });

  it("does not draw tombstoned elements or the group wrapper", () => {
    const { doc, slideId, slide } = deck();
    const a = addShape(doc, slideId, "rect")!;
    const b = addShape(doc, slideId, "rect")!;
    const g = groupElements(doc, slideId, [a, b])!;
    const stage = render({ slide: slide(), theme: "dali-dark" });
    expect(stage.querySelector(`[data-element="${g}"]`)).toBeNull();
    expect(stage.querySelectorAll("[data-element]")).toHaveLength(2);
  });

  it("hides a free element until its build step when presenting", () => {
    const { doc, slideId, slide } = deck();
    const a = addShape(doc, slideId, "rect")!;
    elementsOf(slidesMap(doc).get(slideId)!).get(a)!.set("build", 2);
    expect(render({ slide: slide(), theme: "dali-dark", step: 1 }).querySelector(`[data-element="${a}"]`)).toBeNull();
    expect(render({ slide: slide(), theme: "dali-dark", step: 2 }).querySelector(`[data-element="${a}"]`)).not.toBeNull();
    expect(render({ slide: slide(), theme: "dali-dark" }).querySelector(`[data-element="${a}"]`)).not.toBeNull();
  });
});

describe("SlideRender detached slots", () => {
  it("draws a moved slot element at its own place and leaves a dashed ghost only while editing", () => {
    const { doc, slideId, slide } = deck("split");
    moveElements(doc, slideId, ["image"], 0, 50);
    const plain = render({ slide: slide(), theme: "dali-dark" });
    expect(plain.querySelector("[data-slot-ghost]")).toBeNull();
    const editing = render({ slide: slide(), theme: "dali-dark", placeholders: true });
    const ghost = editing.querySelector("[data-slot-ghost]")!;
    expect(ghost.getAttribute("data-slot-ghost")).toBe("image");
    expect(ghost.textContent).toBe("Image slot · empty");
    const image = editing.querySelector("[data-slot='image']")!;
    expect(style(image).top).toBe("calc(360 * var(--slide-u))");
    expect(style(ghost).top).toBe("calc(310 * var(--slide-u))");
  });

  it("does not ghost an element that still follows its layout", () => {
    const { slide } = deck("split");
    expect(render({ slide: slide(), theme: "dali-dark", placeholders: true }).querySelector("[data-slot-ghost]")).toBeNull();
  });

  it("rotates a detached text slot", () => {
    const { doc, slideId, slide } = deck("content");
    setPlacements(doc, slideId, { body: { x: 100, y: 100, w: 500, h: 300, rot: -3 } });
    const body = render({ slide: slide(), theme: "dali-dark" }).querySelector("[data-slot='body']")!;
    expect(style(body).transform).toBe("rotate(-3deg)");
  });

  it("renders free elements identically for the print and server read paths", () => {
    const { doc, slideId, slide } = deck();
    const r = addShape(doc, slideId, "ellipse")!;
    setPlacements(doc, slideId, { [r]: { x: 10, y: 20, w: 30, h: 40, rot: 5 } });
    const t = addTextBox(doc, slideId)!;
    blocksToFragment([{ type: "paragraph", content: "Hello" }] as never, slideFragment(doc, slideId, t)!);
    const fromDoc = renderToStaticMarkup(createElement(SlideRender, { slide: slide(), theme: "dali-dark" }));
    const fromRead = renderToStaticMarkup(createElement(SlideRender, { slide: toRenderDeck(readDeck(doc)).slides[0], theme: "dali-dark" }));
    expect(fromRead).toContain(`data-element="${r}"`);
    expect(fromRead).toContain("rotate(5deg)");
    expect(fromRead).toContain("Hello");
    expect(fromRead.replace(/data-element-id="[^"]*"/g, "")).toBe(fromDoc.replace(/data-element-id="[^"]*"/g, ""));
  });
});


describe("cropped images", () => {
  it("draws the whole picture scaled and offset inside a clipping box", () => {
    const d = deck();
    const id = addFreeImage(d.doc, d.slideId, "https://x/y.png", "y", null, { x: 960, y: 540 })!;
    setPlacementsW(d.doc, d.slideId, id);
    setCrop(d.doc, d.slideId, id, { l: 0.25, t: 0.5, r: 0.25, b: 0 });
    const stage = render({ slide: d.slide(), theme: "dali-dark" });
    const box = stage.querySelector("[data-cropped]") as HTMLElement;
    expect(box.style.overflow).toBe("hidden");
    const img = box.querySelector("img") as HTMLElement;
    expect(img.style.width).toBe("calc(800 * var(--slide-u))");
    expect(img.style.height).toBe("calc(400 * var(--slide-u))");
    expect(img.style.left).toBe("calc(-200 * var(--slide-u))");
    expect(img.style.top).toBe("calc(-200 * var(--slide-u))");
  });

  it("draws an uncropped image as a plain image", () => {
    const d = deck();
    addFreeImage(d.doc, d.slideId, "https://x/y.png", "y");
    const stage = render({ slide: d.slide(), theme: "dali-dark" });
    expect(stage.querySelector("[data-cropped]")).toBeNull();
    expect(stage.querySelector("img")).not.toBeNull();
  });

  it("shows the crop to viewers who read the deck without connecting", () => {
    const d = deck();
    const id = addFreeImage(d.doc, d.slideId, "https://x/y.png", "y")!;
    setCrop(d.doc, d.slideId, id, { l: 0.2, t: 0, r: 0, b: 0 });
    const read = toRenderDeck(readDeck(d.doc)).slides[0];
    expect(renderToStaticMarkup(createElement(SlideRender, { slide: read, theme: "dali-dark" }))).toContain("data-cropped");
  });
});

function setPlacementsW(doc: Y.Doc, slideId: string, id: string) {
  setPlacements(doc, slideId, { [id]: { x: 100, y: 100, w: 400, h: 200, rot: 0 } });
}
