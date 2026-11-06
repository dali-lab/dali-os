import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { readDeck } from "~/collab/read-deck.server";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addHtml } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { buildDeckPptx, MAX_HTML_RASTERS } from "../export.server";

const PNG = "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function deck(count = 1, fill = false) {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  for (let i = 0; i < count; i++) addHtml(doc, slideId, `<p>${i}</p>`, { fill });
  return readDeck(doc);
}
const build = (read: ReturnType<typeof deck>, rasterizeHtml?: (page: string, size: { w: number; h: number }) => Promise<string | null>) =>
  buildDeckPptx(read, { title: "T", loadImage: async () => null, rasterizeHtml });
const media = async (buffer: Buffer) => Object.keys((await JSZip.loadAsync(buffer)).files).filter((n) => n.startsWith("ppt/media/") && !n.endsWith("/"));
const slideXml = async (buffer: Buffer) => (await JSZip.loadAsync(buffer)).file("ppt/slides/slide1.xml")!.async("string");

describe("PowerPoint export of custom HTML", () => {
  it("rasterizes each element at its size in a sandboxed frame and places the picture", async () => {
    const rasterize = vi.fn(async () => PNG);
    const built = await build(deck(), rasterize);
    expect(rasterize).toHaveBeenCalledTimes(1);
    const [page, size] = rasterize.mock.calls[0] as unknown as [string, { w: number; h: number }];
    expect(size).toEqual({ w: 960, h: 540 });
    expect(page).toContain('sandbox="allow-scripts"');
    expect(page).toContain("width:960px;height:540px");
    expect(page).toContain("Content-Security-Policy");
    expect((await media(built.buffer)).length).toBe(1);
    expect(built.skippedImages).toBe(0);
  });

  it("uses the full slide for a fill element", async () => {
    const rasterize = vi.fn(async () => PNG);
    await build(deck(1, true), rasterize);
    expect((rasterize.mock.calls[0] as unknown as [string, { w: number; h: number }])[1]).toEqual({ w: 1920, h: 1080 });
  });

  it("draws a placeholder card and counts it when the rasterizer returns nothing", async () => {
    const built = await build(deck(), vi.fn(async () => null));
    expect(await media(built.buffer)).toHaveLength(0);
    expect(await slideXml(built.buffer)).toContain("Custom HTML");
    expect(built.skippedImages).toBe(1);
  });

  it("falls back and counts when there is no rasterizer", async () => {
    const built = await build(deck());
    expect(await slideXml(built.buffer)).toContain("Custom HTML");
    expect(built.skippedImages).toBe(1);
  });

  it("rasterizes only the first few elements, and counts the rest", async () => {
    const rasterize = vi.fn(async () => PNG);
    const built = await build(deck(MAX_HTML_RASTERS + 2), rasterize);
    expect(rasterize).toHaveBeenCalledTimes(MAX_HTML_RASTERS);
    expect(built.skippedImages).toBe(2);
  });
});
