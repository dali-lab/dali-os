import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readDeck } from "~/collab/read-deck.server";
import { parseClipboard, serializeSelection } from "../clipboard";
import { addSlide, applyBuildPatches, setBuildEffect, setBuildTiming } from "../deck-ops";
import { addShape, addTextBox, pasteItems } from "../freeform-ops";
import { initDeck } from "../model";
import { parseSlideClipboard, pasteSlides, sanitizeClips, serializeSlides } from "../slide-clipboard";
import { snapshotDeck } from "../snapshot";

function setup() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  const shape = addShape(doc, slideId, "rect")!;
  const text = addTextBox(doc, slideId)!;
  applyBuildPatches(doc, slideId, { [shape]: { build: 2, buildAfter: true, buildDelay: 700 }, [text]: { build: 1, buildAfter: false, buildDelay: null } });
  setBuildEffect(doc, slideId, shape, "scale");
  setBuildTiming(doc, slideId, shape, true, 700);
  const slide = () => snapshotDeck(doc).slides.find((s) => s.id === slideId)!;
  return { doc, slideId, shape, text, slide };
}

describe("snapshot and server read", () => {
  it("expose the new fields", () => {
    const { doc, shape } = setup();
    const snap = snapshotDeck(doc).slides[0].elements.find((e) => e.id === shape)!;
    expect(snap).toMatchObject({ build: 2, buildEffect: "scale", buildAfter: true, buildDelay: 700 });
    expect(readDeck(doc).slides[0].elements.find((e) => e.id === shape)).toMatchObject({ build: 2, buildEffect: "scale", buildAfter: true, buildDelay: 700 });
  });

  it("drop a delay with no after-previous and an unknown effect", () => {
    const { doc, slideId, shape, slide } = setup();
    setBuildTiming(doc, slideId, shape, false, 700);
    expect(slide().elements.find((e) => e.id === shape)).not.toHaveProperty("buildDelay");
  });
});

describe("element clipboard", () => {
  it("carries the fields through copy and paste", () => {
    const { doc, slideId, shape, slide } = setup();
    const items = parseClipboard(serializeSelection(slide(), [shape])!)!;
    expect(items[0]).toMatchObject({ build: 2, buildEffect: "scale", buildAfter: true, buildDelay: 700 });
    const [id] = pasteItems(doc, slideId, items);
    expect(slide().elements.find((e) => e.id === id)).toMatchObject({ build: 2, buildEffect: "scale", buildAfter: true, buildDelay: 700 });
  });

  it("validates them: unknown effects, bad delays and bullets on a shape are dropped", () => {
    const text = JSON.stringify({
      mark: "dali-slides-elements",
      v: 1,
      items: [{ key: "a", kind: "shape", placed: { x: 0, y: 0, w: 100, h: 100, rot: 0 }, build: 3, buildEffect: "spin", buildAfter: true, buildDelay: 99999, buildBullets: true }],
    });
    const [item] = parseClipboard(text)!;
    expect(item).toMatchObject({ build: 3, buildAfter: true, buildDelay: 5000 });
    expect(item).not.toHaveProperty("buildEffect");
    expect(item).not.toHaveProperty("buildBullets");
  });
});

describe("slide clipboard and templates", () => {
  it("carry the fields on free items", () => {
    const { doc, slide } = setup();
    const clips = parseSlideClipboard(serializeSlides([slide()])!)!;
    const [id] = pasteSlides(doc, clips, null);
    const pasted = snapshotDeck(doc).slides.find((s) => s.id === id)!;
    expect(pasted.elements.map((e) => e.build).sort()).toEqual([1, 2]);
    expect(pasted.elements.find((e) => e.build === 2)).toMatchObject({ buildEffect: "scale", buildAfter: true, buildDelay: 700 });
  });

  it("sanitize slot builds on stored templates", () => {
    const clips = sanitizeClips([{ layoutId: "content", slots: [{ slot: "body", blocks: [], build: 2, buildBullets: true, buildEffect: "fade", buildDelay: 10 }, { slot: "title", blocks: [], buildEffect: "bogus" }], items: [] }])!;
    const slots = clips[0].slots;
    expect(slots.find((s) => s.slot === "body")).toMatchObject({ build: 2, buildBullets: true, buildEffect: "fade" });
    expect(slots.find((s) => s.slot === "body")).not.toHaveProperty("buildDelay");
    expect(slots.find((s) => s.slot === "title")).not.toHaveProperty("buildEffect");
  });

  it("write slot builds onto the pasted slide", () => {
    const { doc } = setup();
    const clips = sanitizeClips([{ layoutId: "content", slots: [{ slot: "body", blocks: [], build: 2, buildEffect: "rise" }], items: [] }])!;
    const [id] = pasteSlides(doc, clips, null);
    expect(snapshotDeck(doc).slides.find((s) => s.id === id)!.elements.find((e) => e.slot === "body")).toMatchObject({ build: 2, buildEffect: "rise" });
  });
});
