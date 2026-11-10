import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { cleanPoll, DEFAULT_POLL } from "../content";
import { parseClipboard, serializeSelection } from "../clipboard";
import { addSlide } from "../deck-ops";
import { addPoll, pasteItems, setPoll } from "../freeform-ops";
import { initDeck } from "../model";
import { sanitizeClips, parseSlideClipboard, pasteSlides, serializeSlides, slidesToClips } from "../slide-clipboard";
import { snapshotDeck } from "../snapshot";

const base = { question: "Ship it?", options: ["Yes", "No"] };

describe("cleanPoll", () => {
  it("keeps a valid poll and trims its text", () => {
    expect(cleanPoll({ question: "  Ship it? ", options: [" Yes", "No "], multi: true })).toEqual({ question: "Ship it?", options: ["Yes", "No"], multi: true });
  });

  it("drops multi unless it is exactly true", () => {
    expect(cleanPoll({ ...base, multi: "yes" })).toEqual(base);
  });

  it.each([
    ["too few options", { question: "q", options: ["a"] }],
    ["too many options", { question: "q", options: ["a", "b", "c", "d", "e", "f", "g"] }],
    ["an empty option", { question: "q", options: ["a", " "] }],
    ["a non-string option", { question: "q", options: ["a", 2] }],
    ["no question", { options: ["a", "b"] }],
    ["not an object", "poll"],
  ])("rejects %s", (_name, raw) => {
    expect(cleanPoll(raw)).toBeNull();
  });

  it("cuts overlong text", () => {
    const poll = cleanPoll({ question: "q".repeat(500), options: ["a".repeat(200), "b"] })!;
    expect(poll.question).toHaveLength(200);
    expect(poll.options[0]).toHaveLength(80);
  });
});

function deckWithSlide() {
  const doc = new Y.Doc();
  initDeck(doc);
  return { doc, slideId: addSlide(doc, "blank", null) };
}
const slideOf = (doc: Y.Doc, id: string) => snapshotDeck(doc).slides.find((s) => s.id === id)!;

describe("poll elements", () => {
  it("adds a free poll element that reads back from the snapshot", () => {
    const { doc, slideId } = deckWithSlide();
    const id = addPoll(doc, slideId, base)!;
    const el = slideOf(doc, slideId).elements.find((e) => e.id === id)!;
    expect(el).toMatchObject({ kind: "poll", slot: null, poll: base });
    expect(el.w).toBeGreaterThan(0);
  });

  it("adds the default poll when none is given and refuses an invalid one", () => {
    const { doc, slideId } = deckWithSlide();
    const id = addPoll(doc, slideId)!;
    expect(slideOf(doc, slideId).elements.find((e) => e.id === id)!.poll).toEqual(DEFAULT_POLL);
    expect(addPoll(doc, slideId, { question: "q", options: ["only one"] })).toBeNull();
  });

  it("edits the poll through setPoll and rejects a bad edit", () => {
    const { doc, slideId } = deckWithSlide();
    const id = addPoll(doc, slideId, base)!;
    expect(setPoll(doc, slideId, id, { question: "Which?", options: ["A", "B", "C"], multi: true })).toBe(true);
    expect(slideOf(doc, slideId).elements[0].poll).toEqual({ question: "Which?", options: ["A", "B", "C"], multi: true });
    expect(setPoll(doc, slideId, id, { question: "Which?", options: ["A"] })).toBe(false);
    expect(slideOf(doc, slideId).elements[0].poll!.options).toHaveLength(3);
  });

  it("ignores a stored poll that doesn't validate", () => {
    const { doc, slideId } = deckWithSlide();
    const id = addPoll(doc, slideId, base)!;
    const slide = doc.getMap("slides").get(slideId) as Y.Map<Y.Map<Y.Map<unknown>>>;
    (slide.get("elements") as unknown as Y.Map<Y.Map<unknown>>).get(id)!.set("poll", { question: 4, options: [] });
    expect(slideOf(doc, slideId).elements[0].poll).toBeUndefined();
  });
});

describe("poll clipboard", () => {
  it("round-trips through element copy and paste", () => {
    const { doc, slideId } = deckWithSlide();
    const id = addPoll(doc, slideId, base)!;
    const text = serializeSelection(slideOf(doc, slideId), [id])!;
    const items = parseClipboard(text)!;
    expect(items[0]).toMatchObject({ kind: "poll", poll: base });
    const pasted = pasteItems(doc, slideId, items);
    expect(slideOf(doc, slideId).elements.filter((e) => e.kind === "poll")).toHaveLength(2);
    expect(pasted).toHaveLength(1);
  });

  it("drops a pasted poll with invalid options and keeps nothing it can't validate", () => {
    const bad = JSON.stringify({
      mark: "dali-slides-elements",
      v: 1,
      items: [{ key: "a", kind: "poll", placed: { x: 0, y: 0, w: 100, h: 100, rot: 0 }, poll: { question: "q", options: ["only"] } }],
    });
    expect(parseClipboard(bad)).toBeNull();
  });

  it("strips unknown fields from a pasted poll", () => {
    const text = JSON.stringify({
      mark: "dali-slides-elements",
      v: 1,
      items: [{ key: "a", kind: "poll", placed: { x: 0, y: 0, w: 100, h: 100, rot: 0 }, poll: { question: "q", options: ["a", "b"], onclick: "x" } }],
    });
    expect(parseClipboard(text)![0].poll).toEqual({ question: "q", options: ["a", "b"] });
  });

  it("carries a poll with a copied slide and pastes it as one new slide", () => {
    const { doc, slideId } = deckWithSlide();
    addPoll(doc, slideId, base);
    const text = serializeSlides(snapshotDeck(doc).slides)!;
    const clips = parseSlideClipboard(text)!;
    const ids = pasteSlides(doc, clips, slideId);
    expect(ids).toHaveLength(1);
    expect(slideOf(doc, ids[0]).elements.find((e) => e.kind === "poll")!.poll).toEqual(base);
  });
});

describe("sanitizeClips", () => {
  it("accepts stored clips the way clipboard text is accepted", () => {
    const { doc, slideId } = deckWithSlide();
    addPoll(doc, slideId, base);
    const clips = sanitizeClips(slidesToClips(snapshotDeck(doc).slides));
    expect(clips).toHaveLength(1);
    expect(clips![0].items[0].poll).toEqual(base);
  });

  it("rejects anything that is not a list of slides", () => {
    expect(sanitizeClips(null)).toBeNull();
    expect(sanitizeClips({})).toBeNull();
    expect(sanitizeClips([])).toBeNull();
  });

  it("removes an unsafe image address and an unknown layout is replaced", () => {
    const clips = sanitizeClips([
      { layoutId: "nope", slots: [], items: [{ key: "i", kind: "image", src: "javascript:alert(1)", placed: { x: 0, y: 0, w: 10, h: 10, rot: 0 } }] },
    ])!;
    expect(clips[0].items).toEqual([]);
    expect(clips[0].layoutId).not.toBe("nope");
  });
});

describe("inserting library slides", () => {
  it("is one undo step for all the slides, built from stored clips", async () => {
    const { createDeckUndo } = await import("../deck-undo");
    const { deckMap, slidesMap } = await import("../model");
    const { visibleSlideIds } = await import("../deck-ops");
    const { doc, slideId } = deckWithSlide();
    addPoll(doc, slideId, base);
    const stored = slidesToClips([...snapshotDeck(doc).slides, ...snapshotDeck(doc).slides]);
    const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
    undo.manager.clear();
    const ids = undo.step(() => pasteSlides(doc, sanitizeClips(stored)!, slideId));
    expect(ids).toHaveLength(2);
    expect(visibleSlideIds(doc)).toEqual([slideId, ...ids]);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(visibleSlideIds(doc)).toEqual([slideId]);
  });
});
