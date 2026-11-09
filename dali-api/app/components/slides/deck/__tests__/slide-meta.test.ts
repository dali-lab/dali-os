import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readDeck, toRenderDeck } from "~/collab/read-deck.server";
import { addSlide, duplicateSlide, deleteSlide, moveSection, moveSlides, sectionSlideIds, setSectionStart, setSlideBackground, setSlideTransition, undeleteSlide, visibleSlideIds } from "../deck-ops";
import { createDeckUndo } from "../deck-undo";
import { addIcon, addShape, addTextBox } from "../freeform-ops";
import { parseSlideClipboard, pasteSlides, serializeSlides, SLIDE_CLIP_MARK, SLIDE_CLIP_VERSION } from "../slide-clipboard";
import {
  cleanBackground,
  cleanSection,
  cleanTransition,
  effectiveTransition,
  MAX_SECTION_NAME,
  matchElements,
  planMorph,
  sectionsOf,
} from "../slide-meta";
import { deckMap, initDeck, slidesMap } from "../model";
import { snapshotDeck, type RenderElement, type RenderSlide } from "../snapshot";
import { blocksToFragment } from "~/collab/blocknote-server";
import { slideFragment } from "../deck-ops";

function setup(n = 3) {
  const doc = new Y.Doc();
  initDeck(doc);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(addSlide(doc, "content", ids[i - 1] ?? null));
  const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
  undo.manager.clear();
  return { doc, ids, undo };
}
const slide = (doc: Y.Doc, id: string) => snapshotDeck(doc).slides.find((s) => s.id === id)!;

describe("sanitizers", () => {
  it("accepts theme tokens and safe image urls only", () => {
    expect(cleanBackground({ kind: "color", token: "accent" })).toEqual({ kind: "color", token: "accent" });
    expect(cleanBackground({ kind: "color", token: "#ff0000" })).toBeNull();
    expect(cleanBackground({ kind: "color", token: "red" })).toBeNull();
    expect(cleanBackground({ kind: "image", url: "/api/upload/raw?key=uploads/a.png", fit: "contain" })).toEqual({ kind: "image", url: "/api/upload/raw?key=uploads/a.png", fit: "contain" });
    expect(cleanBackground({ kind: "image", url: "https://x.test/a.png", fit: "weird" })).toEqual({ kind: "image", url: "https://x.test/a.png", fit: "cover" });
    expect(cleanBackground({ kind: "image", url: "javascript:alert(1)", fit: "cover" })).toBeNull();
    expect(cleanBackground({ kind: "image", url: "data:image/png;base64,AAAA", fit: "cover" })).toBeNull();
    expect(cleanBackground("red")).toBeNull();
  });

  it("limits transition kinds and clamps durations", () => {
    expect(cleanTransition({ kind: "push", duration: 99999 })).toEqual({ kind: "push", duration: 3000 });
    expect(cleanTransition({ kind: "dissolve", duration: 1 })).toEqual({ kind: "dissolve", duration: 100 });
    expect(cleanTransition({ kind: "magic" })).toEqual({ kind: "magic" });
    expect(cleanTransition({ kind: "none" })).toBeNull();
    expect(cleanTransition({ kind: "spin" })).toBeNull();
    expect(cleanTransition({ kind: "push", duration: Number.NaN })).toEqual({ kind: "push" });
  });

  it("trims section names and caps their length", () => {
    expect(cleanSection("  Big   idea ")).toBe("Big idea");
    expect(cleanSection("   ")).toBeNull();
    expect(cleanSection(7)).toBeNull();
    expect(cleanSection("x".repeat(500))).toHaveLength(MAX_SECTION_NAME);
  });

  it("plays nothing for none, no transition or reduced motion", () => {
    expect(effectiveTransition({ kind: "push" }, false)).toEqual({ kind: "push", duration: 450 });
    expect(effectiveTransition({ kind: "magic", duration: 900 }, false)).toEqual({ kind: "magic", duration: 900 });
    expect(effectiveTransition({ kind: "push" }, true)).toBeNull();
    expect(effectiveTransition({ kind: "none" }, false)).toBeNull();
    expect(effectiveTransition(undefined, false)).toBeNull();
  });
});

describe("slide fields", () => {
  it("sets and clears a background on several slides as one undo step", () => {
    const { doc, ids, undo } = setup();
    undo.step(() => setSlideBackground(doc, ids.slice(0, 2), { kind: "color", token: "surface" }));
    expect(ids.map((id) => slide(doc, id).background)).toEqual([{ kind: "color", token: "surface" }, { kind: "color", token: "surface" }, undefined]);
    undo.manager.undo();
    expect(ids.map((id) => slide(doc, id).background)).toEqual([undefined, undefined, undefined]);
    undo.manager.redo();
    undo.step(() => setSlideBackground(doc, [ids[0]], null));
    expect(slide(doc, ids[0]).background).toBeUndefined();
  });

  it("ignores a background that fails validation", () => {
    const { doc, ids } = setup(1);
    setSlideBackground(doc, ids, { kind: "image", url: "javascript:x", fit: "cover" });
    setSlideBackground(doc, ids, { kind: "color", token: "pink" as never });
    expect(slide(doc, ids[0]).background).toBeUndefined();
  });

  it("reads only valid fields written by others", () => {
    const { doc, ids } = setup(1);
    const s = slidesMap(doc).get(ids[0])!;
    s.set("background", { kind: "color", token: "#fff" });
    s.set("transition", { kind: "spin" });
    s.set("section", "   ");
    expect(slide(doc, ids[0])).not.toHaveProperty("background");
    expect(slide(doc, ids[0])).not.toHaveProperty("transition");
    expect(slide(doc, ids[0])).not.toHaveProperty("section");
  });

  it("sets a transition in one step", () => {
    const { doc, ids, undo } = setup(2);
    undo.step(() => setSlideTransition(doc, [ids[1]], { kind: "magic", duration: 800 }));
    expect(slide(doc, ids[1]).transition).toEqual({ kind: "magic", duration: 800 });
    undo.manager.undo();
    expect(slide(doc, ids[1]).transition).toBeUndefined();
    setSlideTransition(doc, [ids[1]], { kind: "none" });
    expect(slide(doc, ids[1]).transition).toBeUndefined();
  });

  it("reaches the server read and the render deck", () => {
    const { doc, ids } = setup(2);
    setSlideBackground(doc, [ids[0]], { kind: "color", token: "accent" });
    setSlideTransition(doc, [ids[1]], { kind: "push" });
    setSectionStart(doc, ids[0], "Intro");
    const read = toRenderDeck(readDeck(doc));
    expect(read.slides[0]).toMatchObject({ background: { kind: "color", token: "accent" }, section: "Intro" });
    expect(read.slides[1].transition).toEqual({ kind: "push" });
  });
});

describe("sections", () => {
  const named = (doc: Y.Doc) => sectionsOf(snapshotDeck(doc).slides.map((s) => ({ id: s.id, section: s.section })));

  it("groups slides from a named slide to the next one, with lead slides before the first", () => {
    const { doc, ids } = setup(5);
    setSectionStart(doc, ids[1], "Middle");
    setSectionStart(doc, ids[3], "End");
    const { lead, sections } = named(doc);
    expect(lead).toEqual([ids[0]]);
    expect(sections.map((s) => [s.name, s.slideIds])).toEqual([["Middle", [ids[1], ids[2]]], ["End", [ids[3], ids[4]]]]);
  });

  it("adds, renames and removes in one undo step each", () => {
    const { doc, ids, undo } = setup(2);
    undo.step(() => setSectionStart(doc, ids[0], "One"));
    undo.step(() => setSectionStart(doc, ids[0], "Two"));
    expect(slide(doc, ids[0]).section).toBe("Two");
    undo.step(() => setSectionStart(doc, ids[0], null));
    expect(slide(doc, ids[0]).section).toBeUndefined();
    undo.manager.undo();
    expect(slide(doc, ids[0]).section).toBe("Two");
    undo.manager.undo();
    expect(slide(doc, ids[0]).section).toBe("One");
    setSectionStart(doc, ids[0], "   ");
    expect(slide(doc, ids[0]).section).toBe("One");
  });

  it("moves with its first slide when slides are reordered", () => {
    const { doc, ids } = setup(4);
    setSectionStart(doc, ids[2], "Tail");
    moveSlides(doc, [ids[2]], 0);
    expect(visibleSlideIds(doc)).toEqual([ids[2], ids[0], ids[1], ids[3]]);
    const { sections } = named(doc);
    expect(sections[0]).toMatchObject({ name: "Tail", firstId: ids[2], slideIds: [ids[2], ids[0], ids[1], ids[3]] });
  });

  it("moves a whole section together, up and down, as one undo step", () => {
    const { doc, ids, undo } = setup(5);
    setSectionStart(doc, ids[0], "A");
    setSectionStart(doc, ids[2], "B");
    expect(sectionSlideIds(doc, ids[2])).toEqual([ids[2], ids[3], ids[4]]);
    undo.step(() => moveSection(doc, ids[2], 0));
    expect(visibleSlideIds(doc)).toEqual([ids[2], ids[3], ids[4], ids[0], ids[1]]);
    undo.manager.undo();
    expect(visibleSlideIds(doc)).toEqual(ids);
  });

  it("merges into the section before when its first slide is deleted, and comes back on restore", () => {
    const { doc, ids } = setup(4);
    setSectionStart(doc, ids[0], "A");
    setSectionStart(doc, ids[2], "B");
    deleteSlide(doc, ids[2]);
    expect(named(doc).sections.map((s) => [s.name, s.slideIds])).toEqual([["A", [ids[0], ids[1], ids[3]]]]);
    undeleteSlide(doc, ids[2]);
    expect(named(doc).sections.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("is not copied onto a duplicated slide", () => {
    const { doc, ids } = setup(1);
    setSectionStart(doc, ids[0], "Intro");
    setSlideBackground(doc, ids, { kind: "color", token: "muted" });
    const copy = duplicateSlide(doc, ids[0])!;
    expect(slide(doc, copy).section).toBeUndefined();
    expect(slide(doc, copy).background).toEqual({ kind: "color", token: "muted" });
  });
});

describe("pasting slides", () => {
  it("carries background and transition and drops anything invalid", () => {
    const { doc, ids } = setup(1);
    setSlideBackground(doc, ids, { kind: "color", token: "rule" });
    setSlideTransition(doc, ids, { kind: "dissolve", duration: 300 });
    const text = serializeSlides(snapshotDeck(doc).slides)!;
    const [clip] = parseSlideClipboard(text)!;
    expect(clip.background).toEqual({ kind: "color", token: "rule" });
    expect(clip.transition).toEqual({ kind: "dissolve", duration: 300 });
    const [pasted] = pasteSlides(doc, [clip], ids[0]);
    expect(slide(doc, pasted)).toMatchObject({ background: { kind: "color", token: "rule" }, transition: { kind: "dissolve", duration: 300 } });

    const evil = JSON.stringify({
      mark: SLIDE_CLIP_MARK,
      v: SLIDE_CLIP_VERSION,
      slides: [{ layoutId: "content", background: { kind: "image", url: "javascript:alert(1)", fit: "cover" }, transition: { kind: "spin" }, slots: [], items: [] }],
    });
    const [bad] = parseSlideClipboard(evil)!;
    expect(bad.background).toBeUndefined();
    expect(bad.transition).toBeUndefined();
  });
});

describe("matching elements across slides", () => {
  const el = (id: string, kind: string, extra: Partial<RenderElement> = {}): RenderElement => ({
    id,
    kind,
    slot: null,
    z: 1,
    blocks: [],
    src: null,
    alt: null,
    textStyle: null,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...extra,
  });
  const block = (text: string) => [{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }] as never;
  const slideOf = (id: string, els: RenderElement[]): RenderSlide => ({ id, pos: 0, layoutId: "blank", elements: els });

  it("matches the same element id and kind first", () => {
    const m = matchElements(slideOf("a", [el("x", "shape"), el("y", "shape")]), slideOf("b", [el("y", "shape"), el("z", "shape")]));
    expect([...m]).toEqual([["y", "y"]]);
  });

  it("then matches the same kind with the same text or image or icon", () => {
    const from = slideOf("a", [el("t1", "text", { blocks: block("Hello") }), el("i1", "image", { src: "/a.png" }), el("c1", "icon", { icon: "star" }), el("t2", "text", { blocks: block("Other") })]);
    const to = slideOf("b", [el("t9", "text", { blocks: block("Hello") }), el("i9", "image", { src: "/a.png" }), el("c9", "icon", { icon: "star" }), el("n", "text", { blocks: block("Brand new") })]);
    const m = matchElements(from, to);
    expect(Object.fromEntries(m)).toEqual({ t9: "t1", i9: "i1", c9: "c1" });
  });

  it("never matches across kinds, matches one to one, and ignores empty content", () => {
    const from = slideOf("a", [el("a1", "text", { blocks: block("Same") })]);
    const to = slideOf("b", [el("b1", "text", { blocks: block("Same") }), el("b2", "text", { blocks: block("Same") }), el("b3", "shape"), el("b4", "text")]);
    const m = matchElements(from, to);
    expect([...m]).toEqual([["b1", "a1"]]);
    expect(matchElements(slideOf("a", [el("x", "text")]), slideOf("b", [el("y", "text")])).size).toBe(0);
  });

  it("plans a morph: continuing elements start where they were, others fade", () => {
    const from = slideOf("a", [el("x", "shape", { x: 10, y: 20, w: 30, h: 40, rot: 5 }), el("gone", "shape")]);
    const to = slideOf("b", [el("x", "shape", { x: 500, y: 500, w: 90, h: 90 }), el("fresh", "shape")]);
    const plan = planMorph(from, to);
    expect(plan.starts.get("x")).toEqual({ x: 10, y: 20, w: 30, h: 40, rot: 5 });
    expect([...plan.entering]).toEqual(["fresh"]);
    expect([...plan.leaving]).toEqual(["gone"]);
    expect([...plan.continuing]).toEqual(["x"]);
  });

  it("matches the elements of a duplicated slide by id", () => {
    const { doc, ids } = setup(1);
    const a = addShape(doc, ids[0], "rect")!;
    addIcon(doc, ids[0], "star");
    const t = addTextBox(doc, ids[0])!;
    blocksToFragment([{ type: "paragraph", content: "Hi" }] as never, slideFragment(doc, ids[0], t)!);
    const copy = duplicateSlide(doc, ids[0])!;
    const m = matchElements(slide(doc, ids[0]), slide(doc, copy));
    expect(m.get(a)).toBe(a);
    expect(m.size).toBe(slide(doc, ids[0]).elements.length);
  });
});
