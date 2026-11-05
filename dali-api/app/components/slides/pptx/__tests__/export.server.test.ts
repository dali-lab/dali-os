import JSZip from "jszip";
import { parse } from "pptxtojson/dist/index.js";
import { describe, expect, it, vi } from "vitest";
import type { DeckRead, DeckReadElement, DeckReadSlide } from "~/collab/read-deck.server";
import type { DocBlock } from "~/collab/blocknote-server";
import { buildDeckPptx, blocksToRuns, type ExportImage } from "../export.server";
import { resolveThemeColor } from "../theme-colors";
import { EMU_PER_UNIT, unitsToEmu, unitsToInches, unitsToPoints } from "../units";

const block = (type: string, content: DocBlock["content"], extra: Partial<DocBlock> = {}): DocBlock => ({
  id: "b",
  type,
  props: {},
  content,
  children: [],
  ...extra,
});
const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const para = (t: string, styles: Record<string, unknown> = {}) => block("paragraph", [text(t, styles)]);

const textEl = (slot: string, blocks: DocBlock[], extra: Partial<DeckReadElement> = {}): DeckReadElement => ({
  id: slot,
  kind: "text",
  slot,
  z: 1,
  src: null,
  alt: null,
  textStyle: null,
  blocks,
  text: "",
  ...extra,
});

const slide = (id: string, layoutId: string, elements: DeckReadElement[], notes = ""): DeckReadSlide => ({
  id,
  pos: 1,
  layoutId,
  elements,
  notes: { blocks: [], text: notes },
});

const deck = (slides: DeckReadSlide[], themeId = "dali-dark"): DeckRead => ({ v: 1, themeId, slides, plainText: "" });

const noImages = async () => null;

async function build(read: DeckRead, loadImage: (src: string) => Promise<ExportImage | null> = noImages) {
  const built = await buildDeckPptx(read, { title: "Demo", loadImage });
  return { built, parsed: await parse(built.buffer.buffer.slice(built.buffer.byteOffset, built.buffer.byteOffset + built.buffer.byteLength) as ArrayBuffer) };
}

const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");

describe("EMU conversion", () => {
  it("maps 1920 stage units to the 12192000 EMU slide width", () => {
    expect(EMU_PER_UNIT).toBe(6350);
    expect(unitsToEmu(1920)).toBe(12192000);
    expect(unitsToEmu(1080)).toBe(6858000);
    expect(unitsToInches(1920)).toBeCloseTo(13.3333, 3);
    expect(unitsToPoints(1920)).toBe(960);
  });
});

describe("theme colors", () => {
  it("resolves tokens, hex and color-mix to hex digits", () => {
    expect(resolveThemeColor("var(--color-navy-deep)")).toBe("082330");
    expect(resolveThemeColor("#abcdef")).toBe("ABCDEF");
    expect(resolveThemeColor("color-mix(in srgb, var(--color-brand-white) 50%, #000000)")).toBe("808080");
    expect(resolveThemeColor("var(--unknown)")).toBeNull();
  });
});

describe("blocksToRuns", () => {
  it("carries bold, italic, underline and links, and ends each paragraph", () => {
    const runs = blocksToRuns(
      [
        block("paragraph", [
          text("plain "),
          text("strong", { bold: true }),
          text(" slanted", { italic: true, underline: true }),
          { type: "link", href: "https://dali.dev", content: [text(" site")] },
          { type: "link", href: "/projects/1", content: [text(" local")] },
        ]),
      ],
      { origin: "https://os.example.edu" },
    );
    expect(runs.map((r) => r.text)).toEqual(["plain ", "strong", " slanted", " site", " local"]);
    expect(runs[1].options.bold).toBe(true);
    expect(runs[2].options).toMatchObject({ italic: true, underline: true });
    expect(runs[3].options.hyperlink).toEqual({ url: "https://dali.dev" });
    expect(runs[4].options.hyperlink).toEqual({ url: "https://os.example.edu/projects/1" });
    expect(runs.filter((r) => r.options.breakLine)).toHaveLength(1);
    expect(runs[runs.length - 1].options.breakLine).toBe(true);
  });

  it("turns list blocks into bullets and nests children one level", () => {
    const runs = blocksToRuns([
      block("bulletListItem", [text("one")], { children: [block("bulletListItem", [text("nested")])] }),
      block("numberedListItem", [text("two")]),
    ]);
    expect(runs[0].options.bullet).toBe(true);
    expect(runs[1].options).toMatchObject({ bullet: true, indentLevel: 1 });
    expect(runs[2].options.bullet).toEqual({ type: "number" });
  });

  it("uppercases for styles that ask for it and keeps an empty block as a blank line", () => {
    const runs = blocksToRuns([para("kicker"), block("paragraph", [])], { upper: true });
    expect(runs[0].text).toBe("KICKER");
    expect(runs[1]).toMatchObject({ text: "", options: { breakLine: true } });
  });

  it("marks headings bold with a size the caller resolves", () => {
    const [run] = blocksToRuns([block("heading", [text("Head")], { props: { level: 2 } })]);
    expect(run.options).toMatchObject({ bold: true, fontSize: -1 });
  });
});

describe("buildDeckPptx", () => {
  const slides = [
    slide("a", "title", [textEl("title", [para("Hello")]), textEl("subtitle", [para("World")])], "Say hi"),
    slide("b", "content", [textEl("title", [para("Plan")]), textEl("body", [block("bulletListItem", [text("First")]), block("bulletListItem", [text("Second", { bold: true })])])]),
    slide("c", "section", [textEl("title", [para("Part two")])]),
  ];

  it("writes one slide per deck slide in order at the 13.33 by 7.5 inch size", async () => {
    const { built, parsed } = await build(deck(slides));
    expect(built.slideCount).toBe(3);
    expect(parsed.slides).toHaveLength(3);
    const firstText = (i: number) => plain(parsed.slides[i].elements.map((e) => ("content" in e ? e.content : "")).join(" "));
    expect(firstText(0)).toContain("Hello");
    expect(firstText(1)).toContain("Plan");
    expect(firstText(2)).toContain("Part two");
    const zip = await JSZip.loadAsync(built.buffer);
    const presentation = await zip.file("ppt/presentation.xml")!.async("string");
    expect(presentation).toMatch(/<p:sldSz cx="12192000" cy="6858000"/);
  });

  it("places slot text where the layout puts it, in EMU", async () => {
    const { built } = await build(deck([slides[1]]));
    const zip = await JSZip.loadAsync(built.buffer);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain(`<a:off x="${unitsToEmu(160)}" y="${unitsToEmu(110)}"/>`);
    expect(xml).toContain(`<a:ext cx="${unitsToEmu(1600)}" cy="${unitsToEmu(150)}"/>`);
  });

  it("includes speaker notes and carries bold runs", async () => {
    const { built, parsed } = await build(deck(slides));
    expect(parsed.slides[0].note).toContain("Say hi");
    const zip = await JSZip.loadAsync(built.buffer);
    const second = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(second).toMatch(/b="1"[^>]*>[\s\S]*?<a:t>Second<\/a:t>/);
    expect(second).toContain("<a:buChar");
  });

  it("takes the background and fonts from the deck theme", async () => {
    const dark = await build(deck(slides, "dali-dark"));
    const light = await build(deck(slides, "dali-light"));
    const layouts = async (buffer: Buffer) => {
      const zip = await JSZip.loadAsync(buffer);
      const files = Object.keys(zip.files).filter((f) => /ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f));
      return (await Promise.all(files.map((f) => zip.file(f)!.async("string")))).join("\n");
    };
    expect(await layouts(dark.built.buffer)).toContain("082330");
    expect(await layouts(light.built.buffer)).toContain("FFFFFF");
    const zip = await JSZip.loadAsync(dark.built.buffer);
    const theme = await zip.file("ppt/theme/theme1.xml")!.async("string");
    expect(theme).toContain("Plus Jakarta Sans");
    expect(theme).toContain("Mulish");
  });

  it("builds an empty deck without slides", async () => {
    const { built, parsed } = await build(deck([]));
    expect(built.slideCount).toBe(0);
    expect(parsed.slides).toHaveLength(0);
  });

  it("embeds loaded images and counts the ones that could not be read", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const image = (src: string): DeckReadElement => ({ ...textEl("image", []), kind: "image", src, alt: "A pixel" });
    const loader = vi.fn(async (src: string): Promise<ExportImage | null> =>
      src.includes("good") ? { data: `image/png;base64,${png.toString("base64")}`, size: { width: 1, height: 1 } } : null,
    );
    const read = deck([slide("i", "split", [textEl("title", [para("Pics")]), image("/api/upload/raw?key=uploads/good.png")]), slide("j", "image", [image("/api/upload/raw?key=uploads/bad.png")])]);
    const { built } = await build(read, loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(built.skippedImages).toBe(1);
    const zip = await JSZip.loadAsync(built.buffer);
    expect(Object.keys(zip.files).some((f) => f.startsWith("ppt/media/"))).toBe(true);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain('descr="A pixel"');
  });

  it("leaves out elements whose slot the layout does not draw", async () => {
    const stray = textEl("subtitle", [para("Orphan")]);
    const { built } = await build(deck([slide("x", "content", [textEl("title", [para("Kept")]), stray])]));
    const zip = await JSZip.loadAsync(built.buffer);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain("Kept");
    expect(xml).not.toContain("Orphan");
  });
});
