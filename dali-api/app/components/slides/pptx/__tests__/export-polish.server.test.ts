import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readDeck } from "~/collab/read-deck.server";
import { addSlide, setSectionStart, setSlideBackground, setSlideTransition } from "~/components/slides/deck/deck-ops";
import { initDeck } from "~/components/slides/deck/model";
import { buildDeckPptx, transitionXml } from "../export.server";

const PNG = "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function deck(n: number, edit: (doc: Y.Doc, ids: string[]) => void) {
  const doc = new Y.Doc();
  initDeck(doc);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(addSlide(doc, "blank", ids[i - 1] ?? null));
  edit(doc, ids);
  return readDeck(doc);
}
const build = async (read: ReturnType<typeof deck>, loadImage = async () => ({ data: PNG, size: { width: 400, height: 200 } })) => {
  const built = await buildDeckPptx(read, { title: "T", loadImage });
  return { built, zip: await JSZip.loadAsync(built.buffer) };
};
const xml = (zip: JSZip, n: number) => zip.file(`ppt/slides/slide${n}.xml`)!.async("string");

describe("PowerPoint export of backgrounds", () => {
  it("writes a theme color as the slide background", async () => {
    const { zip } = await build(deck(2, (doc, ids) => setSlideBackground(doc, [ids[0]], { kind: "color", token: "accent" })));
    expect(await xml(zip, 1)).toMatch(/<p:bg>[\s\S]*FF8B81/i);
    expect(await xml(zip, 2)).not.toContain("FF8B81");
  });

  it("puts an image background behind everything, and counts one that cannot be read", async () => {
    const read = deck(1, (doc, ids) => setSlideBackground(doc, ids, { kind: "image", url: "/api/upload/raw?key=uploads/a.png", fit: "contain" }));
    const ok = await build(read);
    expect(await xml(ok.zip, 1)).toContain("<p:pic>");
    expect(ok.built.skippedImages).toBe(0);
    const failed = await build(read, async () => null as never);
    expect(await xml(failed.zip, 1)).not.toContain("<p:pic>");
    expect(failed.built.skippedImages).toBe(1);
  });
});

describe("PowerPoint export of transitions", () => {
  it("writes fade, push and morph on the slides that have them", async () => {
    const read = deck(4, (doc, ids) => {
      setSlideTransition(doc, [ids[1]], { kind: "dissolve" });
      setSlideTransition(doc, [ids[2]], { kind: "push", duration: 300 });
      setSlideTransition(doc, [ids[3]], { kind: "magic" });
    });
    const { zip } = await build(read);
    expect(await xml(zip, 1)).not.toContain("<p:transition");
    expect(await xml(zip, 2)).toContain('<p:transition spd="med"><p:fade/></p:transition>');
    expect(await xml(zip, 3)).toContain('<p:push dir="l"/>');
    const morph = await xml(zip, 4);
    expect(morph).toContain("p159:morph");
    expect(morph).toContain("<mc:Fallback><p:transition spd=\"slow\"><p:fade/>");
    expect(morph.indexOf("<p:transition") ).toBeGreaterThan(morph.indexOf("</p:cSld>"));
  });

  it("leaves a deck with no transitions untouched", async () => {
    const { zip } = await build(deck(2, () => {}));
    expect(await xml(zip, 2)).not.toContain("transition");
  });

  it("maps durations to PowerPoint speeds", () => {
    expect(transitionXml({ kind: "dissolve", duration: 200 })).toContain('spd="fast"');
    expect(transitionXml({ kind: "dissolve", duration: 3000 })).toContain('spd="slow"');
    expect(transitionXml({ kind: "none" })).toBeNull();
  });
});

describe("PowerPoint export of sections", () => {
  it("writes each section with its slides, and a first section for slides before the first one", async () => {
    const read = deck(4, (doc, ids) => {
      setSectionStart(doc, ids[1], "Middle");
      setSectionStart(doc, ids[3], "Middle");
    });
    const { zip } = await build(read);
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    const names = [...pres.matchAll(/<p14:section name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["Slides", "Middle", "Middle 2"]);
    expect([...pres.matchAll(/<p14:sldId /g)]).toHaveLength(4);
  });

  it("writes no sections for a deck without any", async () => {
    const { zip } = await build(deck(2, () => {}));
    expect(await zip.file("ppt/presentation.xml")!.async("string")).not.toContain("p14:sectionLst");
  });
});
