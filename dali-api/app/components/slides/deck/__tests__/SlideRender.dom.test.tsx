// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { blocksToFragment } from "~/collab/blocknote-server";
import { SlideRender, type SlideRenderProps } from "../SlideRender";
import { fragmentToRichDoc } from "../fragment-blocks";
import { LAYOUTS } from "../layouts";
import { snapshotDeck, type RenderSlide } from "../snapshot";
import { initDeck, newElementMap, newSlideMap, slidesMap, elementsOf, textOf, tombstoneSlide } from "../model";

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

const para = (text: string) => [{ type: "paragraph", content: [{ type: "text", text, styles: {} }], children: [] }];
const el = (slot: string, blocks: unknown[] = [], extra: Partial<RenderSlide["elements"][number]> = {}) => ({
  id: slot,
  kind: slot === "image" ? "image" : "text",
  slot,
  z: 1,
  blocks: blocks as never,
  src: null,
  alt: null,
  textStyle: null,
  ...extra,
});
const slide = (layoutId: string, elements: RenderSlide["elements"]): RenderSlide => ({ id: "s", pos: 1, layoutId, elements });

describe("SlideRender", () => {
  it("puts the theme's --slide-* vars on the stage root", () => {
    const stage = render({ slide: slide("content", []), theme: "dali-dark" });
    expect(stage.style.getPropertyValue("--slide-ground")).toContain("navy-deep");
    expect(stage.style.getPropertyValue("--slide-accent")).toContain("accent-coral");
    expect(stage.dataset.theme).toBe("dali-dark");
    expect(stage.style.getPropertyValue("--slide-u")).toBe("calc(100cqw / 1920)");
    expect(render({ slide: slide("content", []), theme: "dali-light" }).dataset.theme).toBe("dali-light");
  });

  it("uses no os-* or semantic app token classes anywhere inside the stage", () => {
    const stage = render({
      slide: slide("split", [
        el("title", para("Hello")),
        el("body", [
          { type: "bulletListItem", content: [{ type: "text", text: "a", styles: { bold: true } }], children: [] },
          { type: "quote", content: [{ type: "text", text: "q", styles: {} }], children: [] },
          { type: "codeBlock", content: [{ type: "text", text: "c", styles: { code: true } }], children: [] },
          { type: "checkListItem", props: { checked: true }, content: [{ type: "text", text: "x", styles: {} }], children: [] },
        ]),
        el("image", [], { src: "https://x/y.png" }),
      ]),
      theme: "dali-dark",
      placeholders: true,
    });
    const classes = [stage, ...stage.querySelectorAll("*")].map((n) => n.getAttribute("class") ?? "").join(" ");
    expect(classes).not.toMatch(/\b(?:bg|text|border|ring|fill|stroke)-(?:os-|card|muted|background|foreground|primary|border|accent\b)/);
    expect(classes).not.toMatch(/\bos-/);
    expect(classes).not.toMatch(/navy-deep|brand-|accent-teal|accent-coral/);
  });

  it("draws each layout slot at its stage rectangle", () => {
    for (const layout of LAYOUTS) {
      const stage = render({
        slide: slide(layout.id, layout.slots.map((s) => (s.kind === "image" ? el("image", [], { src: "https://x/y.png" }) : el(s.slot, para(s.slot))))),
        theme: "dali-dark",
      });
      for (const slot of layout.slots) {
        const node = stage.querySelector<HTMLElement>(`[data-slot="${slot.slot}"]`)!;
        expect(node.style.left).toBe(`calc(${slot.rect.x} * var(--slide-u))`);
        expect(node.style.top).toBe(`calc(${slot.rect.y} * var(--slide-u))`);
        expect(node.style.width).toBe(`calc(${slot.rect.w} * var(--slide-u))`);
      }
    }
  });

  it("shows placeholders only when asked", () => {
    expect(render({ slide: slide("content", []), theme: "dali-dark" }).textContent).toBe("");
    expect(render({ slide: slide("content", []), theme: "dali-dark", placeholders: true }).textContent).toContain("Write something");
  });

  it("lets a caller replace one slot", () => {
    const stage = render({
      slide: slide("content", [el("title", para("T"))]),
      theme: "dali-dark",
      renderSlot: ({ slot, fallback }) => (slot.slot === "title" ? createElement("div", { "data-live": "yes" }, "live") : fallback),
    });
    expect(stage.querySelector("[data-live]")?.textContent).toBe("live");
  });

  it("an element's text style overrides the slot's", () => {
    const stage = render({ slide: slide("content", [el("body", para("x"), { textStyle: "kicker" })]), theme: "dali-dark" });
    expect(stage.querySelector<HTMLElement>('[data-slot="body"]')!.style.fontSize).toBe("var(--slide-kicker-size)");
  });
});

describe("static text from a Y fragment", () => {
  it("reads blocks, marks, links and nesting without an editor", async () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("t");
    blocksToFragment(
      [
        { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Hi ", styles: { bold: true } }, { type: "link", href: "https://a.b", content: [{ type: "text", text: "lnk", styles: {} }] }] },
        { type: "bulletListItem", content: "one", children: [{ type: "paragraph", content: "kid" }] },
      ] as never,
      frag,
    );
    const before = frag.toString();
    const blocks = fragmentToRichDoc(frag) as unknown as Array<{ type: string; props: { level?: number }; content: unknown[]; children: unknown[] }>;
    expect(blocks.map((b) => b.type)).toEqual(["heading", "bulletListItem"]);
    expect(blocks[0].props.level).toBe(2);
    expect(blocks[0].content).toEqual([
      { type: "text", text: "Hi ", styles: { bold: true } },
      { type: "link", href: "https://a.b", content: [{ type: "text", text: "lnk", styles: {} }] },
    ]);
    expect(blocks[1].children).toHaveLength(1);
    expect(frag.toString()).toBe(before);
  });

  it("trims trailing empty paragraphs and reads an empty fragment as no blocks", () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("t");
    expect(fragmentToRichDoc(frag)).toEqual([]);
    blocksToFragment([{ type: "paragraph", content: "a" }, { type: "paragraph" }] as never, frag);
    expect(fragmentToRichDoc(frag)).toHaveLength(1);
    expect(fragmentToRichDoc(undefined)).toEqual([]);
  });

  it("snapshots a deck: sorted, tombstones excluded, text drawn by SlideRender", () => {
    const doc = new Y.Doc();
    initDeck(doc);
    for (const [id, pos] of [["b", 2], ["a", 1], ["c", 3]] as const) {
      const s = newSlideMap(id, pos, "content");
      slidesMap(doc).set(id, s);
      elementsOf(s).set("title", newElementMap("title", "text", 1, { slot: "title" }));
      const f = new Y.XmlFragment();
      textOf(s).set("title", f);
      blocksToFragment([{ type: "paragraph", content: `Slide ${id}` }] as never, f);
    }
    tombstoneSlide(slidesMap(doc).get("c")!);
    const snap = snapshotDeck(doc);
    expect(snap.slides.map((s) => s.id)).toEqual(["a", "b"]);
    expect(snap.deletedIds).toEqual(["c"]);
    expect(snap.themeId).toBe("dali-dark");
    expect(render({ slide: snap.slides[0], theme: snap.themeId }).textContent).toBe("Slide a");
  });
});

describe("SlideRender build steps", () => {
  const builds = slide("split", [
    el("title", para("Plan")),
    el("body", [...para("one"), ...para("two"), ...para("three")], { build: 1, buildBullets: true }),
    el("image", [], { build: 3, src: "https://example.test/a.png" }),
  ]);
  const view = (step?: number) => {
    const stage = render({ slide: builds, theme: "dali-dark", step });
    return {
      body: stage.querySelector("[data-slot=body]"),
      shown: stage.querySelector("[data-slot=body]")?.textContent ?? null,
      image: stage.querySelector("[data-slot=image]"),
      title: stage.querySelector("[data-slot=title]")?.textContent,
    };
  };

  it("shows everything when no step is given, as the editor and thumbnails do", () => {
    const v = view();
    expect(v.shown).toContain("three");
    expect(v.image).not.toBeNull();
  });

  it("hides what hasn't appeared at step 0 and keeps the rest", () => {
    const v = view(0);
    expect(v.title).toBe("Plan");
    expect(v.body).toBeNull();
    expect(v.image).toBeNull();
  });

  it("shows the slot at its step with no bullets, then one more bullet per step", () => {
    expect(view(1).shown).toBe("");
    expect(view(2).shown).toBe("one");
    expect(view(3).shown).toBe("onetwo");
    expect(view(3).image).not.toBeNull();
    expect(view(4).shown).toBe("onetwothree");
  });

  it("does not split a slot's blocks when it isn't set to build bullets", () => {
    const plain = slide("content", [el("body", [...para("one"), ...para("two")], { build: 1 })]);
    const stage = render({ slide: plain, theme: "dali-dark", step: 1 });
    expect(stage.querySelector("[data-slot=body]")!.textContent).toBe("onetwo");
  });
});
