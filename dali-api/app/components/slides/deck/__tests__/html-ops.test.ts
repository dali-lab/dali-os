import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readDeck, toRenderDeck } from "~/collab/read-deck.server";
import { CLIP_MARK, CLIP_VERSION, parseClipboard, serializeSelection } from "../clipboard";
import { cleanHtmlSource, htmlSourceOf, MAX_HTML_CHARS } from "../content";
import { addSlide } from "../deck-ops";
import { createDeckUndo } from "../deck-undo";
import { addHtml, deleteElements, duplicateElements, pasteItems, setHtmlFill, setHtmlSource } from "../freeform-ops";
import { htmlSrcDoc, htmlThemeVars, HTML_THEME_VARS } from "../html-element";
import { themeFontsHref } from "../theme-tokens";
import { deckMap, elementsOf, initDeck, slidesMap } from "../model";
import { snapshotDeck, type RenderElement } from "../snapshot";
import { parseSlideClipboard, pasteSlides, serializeSlides } from "../slide-clipboard";
import { THEMES } from "../themes";

function setup() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
  undo.manager.clear();
  return { doc, slideId, undo };
}
const slide = (doc: Y.Doc) => snapshotDeck(doc).slides[0];
const el = (doc: Y.Doc, id: string): RenderElement => slide(doc).elements.find((e) => e.id === id)!;
const raw = (doc: Y.Doc, slideId: string, id: string) => elementsOf(slidesMap(doc).get(slideId)!).get(id)!;

describe("html source cleaning", () => {
  it("strips NUL bytes and refuses source over the cap", () => {
    expect(cleanHtmlSource("a\u0000b")).toBe("ab");
    expect(cleanHtmlSource("x".repeat(MAX_HTML_CHARS))).toHaveLength(MAX_HTML_CHARS);
    expect(cleanHtmlSource("x".repeat(MAX_HTML_CHARS + 1))).toBeNull();
    expect(cleanHtmlSource(42)).toBeNull();
  });

  it("truncates defensively when reading from a doc", () => {
    expect(htmlSourceOf("y".repeat(MAX_HTML_CHARS + 50))).toHaveLength(MAX_HTML_CHARS);
    const text = new Y.Doc().getText("t");
    text.insert(0, "hi\u0000");
    expect(htmlSourceOf(text)).toBe("hi");
    expect(htmlSourceOf(undefined)).toBeUndefined();
    expect(htmlSourceOf(7)).toBeUndefined();
  });
});

describe("html elements in the deck", () => {
  it("is one undo step to insert, and undo tombstones it without removing it", () => {
    const { doc, slideId, undo } = setup();
    const id = undo.step(() => addHtml(doc, slideId, "<p>hi</p>"))!;
    expect(el(doc, id)).toMatchObject({ kind: "html", html: "<p>hi</p>", w: 960, h: 540 });
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(slide(doc).elements.find((e) => e.id === id)).toBeUndefined();
    expect(raw(doc, slideId, id).get("deleted")).toBe(true);
    undo.manager.redo();
    expect(el(doc, id).html).toBe("<p>hi</p>");
  });

  it("refuses an oversize insert and writes nothing", () => {
    const { doc, slideId } = setup();
    expect(addHtml(doc, slideId, "x".repeat(MAX_HTML_CHARS + 1))).toBeNull();
    expect(slide(doc).elements).toHaveLength(0);
  });

  it("deletes as a tombstone", () => {
    const { doc, slideId } = setup();
    const id = addHtml(doc, slideId)!;
    deleteElements(doc, slideId, [id]);
    expect(slide(doc).elements).toHaveLength(0);
    expect(raw(doc, slideId, id).get("deleted")).toBe(true);
  });

  it("stores the source as a shared text", () => {
    const { doc, slideId } = setup();
    const id = addHtml(doc, slideId, "<b>x</b>")!;
    expect(raw(doc, slideId, id).get("html")).toBeInstanceOf(Y.Text);
  });

  it("keeps both sides of a concurrent edit to the source", () => {
    const a = setup();
    const id = addHtml(a.doc, a.slideId, "<p>middle</p>")!;
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
    setHtmlSource(a.doc, a.slideId, id, "<h1>top</h1><p>middle</p>");
    const textB = elementsOf(slidesMap(b).get(a.slideId)!).get(id)!.get("html") as Y.Text;
    textB.insert(textB.length, "<footer>end</footer>");
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
    expect(el(a.doc, id).html).toBe("<h1>top</h1><p>middle</p><footer>end</footer>");
    expect(snapshotDeck(b).slides[0].elements[0].html).toBe(el(a.doc, id).html);
  });

  it("edits only the changed range", () => {
    const { doc, slideId } = setup();
    const id = addHtml(doc, slideId, "<p>abc</p>")!;
    const text = raw(doc, slideId, id).get("html") as Y.Text;
    const seen: string[] = [];
    text.observe((e) => seen.push(JSON.stringify(e.delta)));
    expect(setHtmlSource(doc, slideId, id, "<p>abXc</p>")).toBe(true);
    expect(seen).toEqual([JSON.stringify([{ retain: 5 }, { insert: "X" }])]);
  });

  it("refuses an oversize edit and keeps the old source", () => {
    const { doc, slideId } = setup();
    const id = addHtml(doc, slideId, "<p>ok</p>")!;
    expect(setHtmlSource(doc, slideId, id, "z".repeat(MAX_HTML_CHARS + 1))).toBe(false);
    expect(el(doc, id).html).toBe("<p>ok</p>");
    expect(setHtmlSource(doc, slideId, id, "a\u0000b")).toBe(true);
    expect(el(doc, id).html).toBe("ab");
  });

  it("ignores a source edit aimed at another kind", () => {
    const { doc, slideId } = setup();
    const id = addHtml(doc, slideId)!;
    elementsOf(slidesMap(doc).get(slideId)!).get(id)!.set("kind", "shape");
    setHtmlSource(doc, slideId, id, "nope");
    expect((raw(doc, slideId, id).get("html") as Y.Text).toString()).not.toBe("nope");
  });

  it("covers the slide and locks when it fills, whatever geometry is stored", () => {
    const { doc, slideId } = setup();
    const id = addHtml(doc, slideId, "<p>x</p>", { fill: true })!;
    const raw1 = raw(doc, slideId, id);
    raw1.set("x", 100);
    raw1.set("rot", 30);
    expect(el(doc, id)).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080, htmlFill: true, locked: true });
    expect(el(doc, id).rot).toBeUndefined();
    setHtmlFill(doc, slideId, id, false);
    expect(el(doc, id)).toMatchObject({ w: 960, h: 540 });
    expect(el(doc, id).htmlFill).toBeUndefined();
    expect(el(doc, id).locked).toBeUndefined();
    setHtmlFill(doc, slideId, id, true);
    expect(el(doc, id)).toMatchObject({ w: 1920, h: 1080, htmlFill: true });
  });

  it("duplicates with its own copy of the source", () => {
    const { doc, slideId } = setup();
    const id = addHtml(doc, slideId, "<p>one</p>")!;
    const [copy] = duplicateElements(doc, slideId, [id]);
    setHtmlSource(doc, slideId, copy, "<p>two</p>");
    expect(el(doc, id).html).toBe("<p>one</p>");
    expect(el(doc, copy).html).toBe("<p>two</p>");
  });

  it("reads through the server decoder and the render deck, with fill applied", () => {
    const { doc, slideId } = setup();
    addHtml(doc, slideId, "<p>x</p>", { fill: true });
    const read = readDeck(doc);
    expect(read.slides[0].elements[0]).toMatchObject({ kind: "html", html: "<p>x</p>", w: 1920, htmlFill: true });
    expect(toRenderDeck(read).slides[0].elements[0]).toMatchObject({ kind: "html", html: "<p>x</p>", w: 1920, h: 1080 });
  });
});

describe("html on the clipboard and in slide paste", () => {
  it("round-trips through copy and paste", () => {
    const { doc, slideId } = setup();
    const id = addHtml(doc, slideId, "<p>copy</p>", { fill: true })!;
    const items = parseClipboard(serializeSelection(slide(doc), [id])!)!;
    expect(items[0]).toMatchObject({ kind: "html", html: "<p>copy</p>", htmlFill: true });
    const [pasted] = pasteItems(doc, slideId, items);
    expect(el(doc, pasted)).toMatchObject({ kind: "html", html: "<p>copy</p>", htmlFill: true });
  });

  const clip = (item: Record<string, unknown>) => JSON.stringify({ mark: CLIP_MARK, v: CLIP_VERSION, items: [{ key: "a", placed: { x: 0, y: 0, w: 10, h: 10 }, ...item }] });

  it("drops html over the cap, with the wrong type, and unknown kinds", () => {
    expect(parseClipboard(clip({ kind: "html", html: "x".repeat(MAX_HTML_CHARS + 1) }))).toBeNull();
    expect(parseClipboard(clip({ kind: "html", html: 5 }))).toBeNull();
    expect(parseClipboard(clip({ kind: "script", html: "<p>" }))).toBeNull();
    expect(parseClipboard(clip({ kind: "html", html: "ok\u0000", htmlFill: "yes" }))![0]).toEqual(expect.objectContaining({ kind: "html", html: "ok" }));
    expect(parseClipboard(clip({ kind: "html", html: "ok", htmlFill: "yes" }))![0]).not.toHaveProperty("htmlFill");
  });

  it("carries html through slide copy, paste and saved templates", () => {
    const { doc, slideId } = setup();
    addHtml(doc, slideId, "<p>slide</p>", { fill: true });
    const clips = parseSlideClipboard(serializeSlides(snapshotDeck(doc).slides)!)!;
    const [id] = pasteSlides(doc, clips, slideId);
    const pasted = snapshotDeck(doc).slides.find((s) => s.id === id)!;
    expect(pasted.elements[0]).toMatchObject({ kind: "html", html: "<p>slide</p>", htmlFill: true });
  });
});

describe("html theme", () => {
  it("gives every theme concrete values for each documented variable", () => {
    for (const theme of THEMES) {
      const vars = htmlThemeVars(theme);
      expect(Object.keys(vars).sort()).toEqual([...HTML_THEME_VARS].sort());
      for (const name of ["--slide-accent", "--slide-fg", "--slide-muted", "--slide-surface", "--slide-ground", "--slide-rule"] as const) {
        expect(vars[name]).toMatch(/^#[0-9A-F]{6}$/);
      }
      expect(vars["--slide-font-body"]).toContain("Mulish");
    }
    expect(htmlThemeVars("dali-dark")["--slide-ground"]).toBe("#082330");
  });

  it("matches the colors and fonts in app.css", () => {
    const css = readFileSync(new URL("../../../../app.css", import.meta.url), "utf8");
    const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)![1].toUpperCase();
    expect(htmlThemeVars("dali-dark")["--slide-ground"]).toBe(token("--color-navy-deep"));
    expect(htmlThemeVars("dali-dark")["--slide-accent"]).toBe(token("--color-accent-coral"));
    expect(htmlThemeVars("dali-light")["--slide-accent"]).toBe(token("--color-accent-teal"));
    expect(htmlThemeVars("dali-light")["--slide-rule"]).toBe(token("--color-brand-gray"));
    expect(css).toContain(`--font-os: ${htmlThemeVars("dali-dark")["--slide-font-body"]};`);
    expect(css).toContain(`--font-os-logo: ${htmlThemeVars("dali-dark")["--slide-font-display"]};`);
  });

  it("builds a document with the docs policy, the theme, a reset and then the source", () => {
    const doc = htmlSrcDoc("<p id=mine>x</p>", "dali-light");
    expect(doc.startsWith('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("--slide-accent:#00ADAB");
    expect(doc).toContain("html,body{margin:0;height:100%}");
    expect(doc.indexOf("<style>")).toBeLessThan(doc.indexOf("<p id=mine>"));
  });

  it("loads the theme fonts inside the frame, before the source", () => {
    const doc = htmlSrcDoc("<p id=mine>x</p>", "dali-dark");
    const href = /<link rel="stylesheet" href="([^"]+)">/.exec(doc)![1].replace(/&amp;/g, "&");
    expect(href).toBe(themeFontsHref());
    expect(href).toContain("family=Mulish");
    expect(href).toContain("family=Plus+Jakarta+Sans");
    expect(doc.indexOf("<link")).toBeLessThan(doc.indexOf("<p id=mine>"));
  });
});
