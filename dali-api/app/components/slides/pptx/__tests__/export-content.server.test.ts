import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { readDeck } from "~/collab/read-deck.server";
import { addSlide, slideFragment } from "~/components/slides/deck/deck-ops";
import { addChart, addIcon, addPoll, addTable, addVideo, setChart } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { buildDeckPptx } from "../export.server";
import { writeBlocks } from "../fragment-write";

const PNG = "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function deck(build: (doc: Y.Doc, slideId: string) => void) {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  build(doc, slideId);
  return readDeck(doc);
}
const zipOf = async (read: ReturnType<typeof deck>, rasterize?: (svg: string, size: number) => Promise<string | null>) => {
  const built = await buildDeckPptx(read, { title: "T", loadImage: async () => null, rasterize });
  return { built, zip: await JSZip.loadAsync(built.buffer) };
};
const slideXml = (zip: JSZip) => zip.file("ppt/slides/slide1.xml")!.async("string");
const names = (zip: JSZip, prefix: string) => Object.keys(zip.files).filter((n) => n.startsWith(prefix));

describe("PowerPoint export of new elements", () => {
  it("writes charts as native charts with their data and series", async () => {
    const { zip } = await zipOf(
      deck((doc, id) => {
        const chart = addChart(doc, id, "bar")!;
        setChart(doc, id, chart, { type: "bar", data: { labels: ["Mon", "Tue"], series: [{ name: "Sales", values: [3, 5] }, { name: "Costs", values: [1, 2] }] } });
        addChart(doc, id, "line");
        addChart(doc, id, "pie");
      }),
    );
    const charts = names(zip, "ppt/charts/chart").filter((n) => n.endsWith(".xml") && !n.includes("rels"));
    expect(charts).toHaveLength(3);
    const xml = await Promise.all(charts.map((n) => zip.file(n)!.async("string")));
    const bar = xml.find((x) => x.includes("<c:barChart>"))!;
    expect(bar).toContain("Sales");
    expect(bar).toContain("Costs");
    expect(bar).toContain("Mon");
    expect(xml.some((x) => x.includes("<c:lineChart>"))).toBe(true);
    expect(xml.some((x) => x.includes("<c:pieChart>"))).toBe(true);
    expect(await slideXml(zip)).toContain("graphicFrame");
  });

  it("writes tables as native tables with a filled header row", async () => {
    const { zip } = await zipOf(
      deck((doc, id) => {
        const t = addTable(doc, id, undefined, 2, 2)!;
        const fragment = slideFragment(doc, id, t)!;
        fragment.delete(0, fragment.length);
        writeBlocks(fragment, [
          {
            type: "table",
            content: [],
            children: [],
            table: { header: true, rows: [[[{ type: "text", text: "Name", styles: {} }], [{ type: "text", text: "Role", styles: { bold: true } }]], [[{ type: "text", text: "Ada", styles: {} }], [{ type: "text", text: "Lead", styles: {} }]]] },
          },
        ]);
      }),
    );
    const xml = await slideXml(zip);
    expect(xml).toContain("<a:tbl>");
    expect(xml.match(/<a:tr /g)).toHaveLength(2);
    for (const word of ["Name", "Role", "Ada", "Lead"]) expect(xml).toContain(word);
    expect(xml).toMatch(/<a:tcPr[^>]*>[\s\S]*?<a:solidFill>/);
  });

  it("embeds icons as PNG pictures when a rasterizer is given, and counts them as skipped when not", async () => {
    const read = deck((doc, id) => void addIcon(doc, id, "rocket"));
    const rasterize = vi.fn(async () => PNG);
    const withRaster = await zipOf(read, rasterize);
    expect(rasterize).toHaveBeenCalledWith(expect.stringContaining("<svg"), 256);
    expect(await slideXml(withRaster.zip)).toContain("<p:pic>");
    expect(withRaster.built.skippedImages).toBe(0);
    const without = await zipOf(read);
    expect(await slideXml(without.zip)).not.toContain("<p:pic>");
    expect(without.built.skippedImages).toBe(1);
    const failing = await zipOf(read, async () => null);
    expect(failing.built.skippedImages).toBe(1);
  });

  it("writes a video as a card that links to the video", async () => {
    const { zip } = await zipOf(deck((doc, id) => void addVideo(doc, id, "https://youtu.be/dQw4w9WgXcQ")));
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(rels).toContain("https://youtu.be/dQw4w9WgXcQ");
    expect(await slideXml(zip)).toContain("YouTube video");
  });

  it("writes a poll as a card with its question and options", async () => {
    const { zip } = await zipOf(deck((doc, id) => void addPoll(doc, id, { question: "Ship it?", options: ["Yes", "Not yet"] })));
    const xml = await slideXml(zip);
    for (const word of ["Ship it?", "Yes", "Not yet"]) expect(xml).toContain(word);
  });
});
