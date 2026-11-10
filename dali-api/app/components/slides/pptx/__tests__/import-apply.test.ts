import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";
import { fragmentToBlocks } from "~/collab/blocknote-server";
import { readDeck } from "~/collab/read-deck.server";
import { DECK_CREATE, addSlide } from "~/components/slides/deck/deck-ops";
import { createDeckUndo } from "~/components/slides/deck/deck-undo";
import { deckMap, initDeck, slidesMap } from "~/components/slides/deck/model";
import { appendSlides, chunkSlides, CHUNK_BYTES } from "../import-apply";
import { writeBlocks, paragraphsOf } from "../fragment-write";
import { importSummary, MAX_PPTX_BYTES, MAX_PPTX_SLIDES, uploadImages, validatePptxFile } from "../import-client";
import { takeImport, stashImport } from "../pending-import";
import type { ImportBlock, ImportPlan, ReadySlide } from "../import-types";

const para = (text: string, styles: Record<string, boolean> = {}): ImportBlock => ({
  type: "paragraph",
  content: [{ type: "text", text, styles }],
  children: [],
});

const ready = (over: Partial<ReadySlide> = {}): ReadySlide => ({
  layoutId: "content",
  title: [para("Title")],
  subtitle: [],
  body: [para("Body")],
  image: null,
  notes: "",
  ...over,
});

const newDeck = () => {
  const doc = new Y.Doc();
  initDeck(doc);
  return doc;
};

describe("writeBlocks", () => {
  it("writes a fragment that the server reader decodes back to the same blocks", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("f");
    const blocks: ImportBlock[] = [
      para("plain"),
      { type: "paragraph", content: [{ type: "text", text: "bold", styles: { bold: true, italic: true } }, { type: "link", href: "https://example.edu", content: [{ type: "text", text: "site", styles: { underline: true } }] }], children: [] },
      { type: "bulletListItem", content: [{ type: "text", text: "item", styles: {} }], children: [{ type: "numberedListItem", content: [{ type: "text", text: "kid", styles: {} }], children: [] }] },
    ];
    writeBlocks(fragment, blocks);
    const read = fragmentToBlocks(fragment);
    expect(read.map((b) => b.type)).toEqual(["paragraph", "paragraph", "bulletListItem"]);
    expect(read[1].content).toEqual([
      { type: "text", text: "bold", styles: { bold: true, italic: true } },
      { type: "link", href: "https://example.edu", content: [{ type: "text", text: "site", styles: { underline: true } }] },
    ]);
    expect(read[2].children.map((c) => c.type)).toEqual(["numberedListItem"]);
    expect(read[2].children[0].content).toEqual([{ type: "text", text: "kid", styles: {} }]);
  });

  it("leaves a fragment empty for no blocks and splits notes into paragraphs", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("f");
    writeBlocks(fragment, []);
    expect(fragment.length).toBe(0);
    expect(paragraphsOf("a\n\n b \r\nc").map((b) => b.content[0].text)).toEqual(["a", " b ", "c"]);
  });
});

describe("appendSlides", () => {
  it("adds slides after the current ones with slots, text, image and notes", () => {
    const doc = newDeck();
    const existing = addSlide(doc, "title", null);
    const ids = appendSlides(doc, [
      ready({ layoutId: "split", image: { src: "/api/upload/raw?key=uploads/doc-images/a.png", alt: "" }, notes: "Say hello\nThen go" }),
      ready({ layoutId: "title", title: [para("Second")], body: [] }),
    ]);
    const read = readDeck(doc);
    expect(read.slides.map((s) => s.id)).toEqual([existing, ...ids]);
    const [, split, title] = read.slides;
    expect(split.layoutId).toBe("split");
    expect(split.elements.find((e) => e.slot === "title")!.text).toBe("Title");
    expect(split.elements.find((e) => e.slot === "body")!.text).toBe("Body");
    expect(split.elements.find((e) => e.slot === "image")!.src).toBe("/api/upload/raw?key=uploads/doc-images/a.png");
    expect(split.notes.text).toBe("Say hello\nThen go");
    expect(title.elements.find((e) => e.slot === "title")!.text).toBe("Second");
  });

  it("works on an empty deck and keeps appending in order across calls", () => {
    const doc = newDeck();
    const first = appendSlides(doc, [ready({ title: [para("A")] }), ready({ title: [para("B")] })]);
    const second = appendSlides(doc, [ready({ title: [para("C")] })]);
    const titles = readDeck(doc).slides.map((s) => s.elements.find((e) => e.slot === "title")!.text);
    expect(titles).toEqual(["A", "B", "C"]);
    expect(readDeck(doc).slides.map((s) => s.id)).toEqual([...first, ...second]);
  });

  it("stores only the image URL it was given", () => {
    const doc = newDeck();
    const [id] = appendSlides(doc, [ready({ layoutId: "image", image: { src: "/api/upload/raw?key=uploads/doc-images/x.png", alt: "Photo" } })]);
    const image = (slidesMap(doc).get(id)!.get("elements") as Y.Map<Y.Map<unknown>>).get("image")!;
    expect(image.get("src")).toBe("/api/upload/raw?key=uploads/doc-images/x.png");
    expect(String(image.get("src"))).not.toMatch(/^data:/);
  });

  it("writes with the create origin so undo leaves it alone", () => {
    const doc = newDeck();
    const origins: unknown[] = [];
    doc.on("afterTransaction", (t: Y.Transaction) => origins.push(t.origin));
    const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
    appendSlides(doc, [ready()]);
    expect(origins).toContain(DECK_CREATE);
    expect(undo.manager.undoStack).toHaveLength(0);
    undo.destroy();
  });
});

describe("chunkSlides", () => {
  const big = (n: number) => ready({ body: [para("x".repeat(n))] });

  it("keeps a small import in one chunk and keeps order", () => {
    const slides = [big(10), big(20), big(30)];
    expect(chunkSlides(slides)).toEqual([slides]);
  });

  it("splits a large import so no chunk passes the limit, without reordering", () => {
    const slides = Array.from({ length: 20 }, (_, i) => ready({ title: [para(`s${i}`)], body: [para("y".repeat(60_000))] }));
    const chunks = chunkSlides(slides);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(slides);
    for (const chunk of chunks) expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(CHUNK_BYTES + 200);
  });

  it("puts a slide over the limit in a chunk of its own", () => {
    const chunks = chunkSlides([big(10), big(CHUNK_BYTES + 1), big(10)]);
    expect(chunks.map((c) => c.length)).toEqual([1, 1, 1]);
  });

  it("returns no chunks for no slides", () => {
    expect(chunkSlides([])).toEqual([]);
  });

  it("produces transactions each below the limit when applied", () => {
    const doc = newDeck();
    const updates: number[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u.length));
    const slides = Array.from({ length: 12 }, () => ready({ body: [para("z".repeat(80_000))] }));
    for (const chunk of chunkSlides(slides)) appendSlides(doc, chunk);
    expect(readDeck(doc).slides).toHaveLength(12);
    expect(updates.length).toBeGreaterThan(1);
    for (const size of updates) expect(size).toBeLessThan(CHUNK_BYTES);
  });
});

describe("validatePptxFile", () => {
  const file = (name: string, size = 1000, type = "") => ({ name, size, type });
  const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  it("accepts .pptx with the right or an empty type", () => {
    expect(validatePptxFile(file("Deck.PPTX"))).toBeNull();
    expect(validatePptxFile(file("deck.pptx", 10, PPTX_MIME))).toBeNull();
  });

  it("rejects other types, the old .ppt format and mismatched mime types", () => {
    expect(validatePptxFile(file("deck.ppt"))).toMatch(/\.pptx/);
    expect(validatePptxFile(file("deck.pdf", 10, "application/pdf"))).toMatch(/\.pptx/);
    expect(validatePptxFile(file("deck.pptx", 10, "text/html"))).toMatch(/\.pptx/);
  });

  it("rejects empty and oversized files", () => {
    expect(validatePptxFile(file("deck.pptx", 0))).toMatch(/empty/);
    expect(validatePptxFile(file("deck.pptx", MAX_PPTX_BYTES + 1))).toMatch(/larger than/);
    expect(validatePptxFile(file("deck.pptx", MAX_PPTX_BYTES))).toBeNull();
  });
});

describe("uploadImages", () => {
  const png = (tag: string) => `data:image/png;base64,${Buffer.from(tag).toString("base64")}`;
  const planOf = (...srcs: Array<string | null>): ImportPlan => ({
    slides: srcs.map((src, i) => ({ layoutId: "split", title: [], subtitle: [], body: [], notes: "", image: src ? { dataUrl: src, alt: "", name: `slide-${i + 1}-image` } : null })),
    skipped: { table: 1 },
  });

  it("uploads each image once and stores only the returned URLs", async () => {
    const upload = vi.fn(async (file: File) => `/api/upload/raw?key=uploads/doc-images/${file.name}`);
    const same = png("same");
    const result = await uploadImages(planOf(same, png("other"), same, null), upload);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0][0]).toBeInstanceOf(File);
    expect(upload.mock.calls[0][0].type).toBe("image/png");
    expect(result.slides.map((s) => s.image?.src)).toEqual([
      "/api/upload/raw?key=uploads/doc-images/slide-1-image.png",
      "/api/upload/raw?key=uploads/doc-images/slide-2-image.png",
      "/api/upload/raw?key=uploads/doc-images/slide-1-image.png",
      undefined,
    ]);
    expect(JSON.stringify(result)).not.toContain("data:image");
    expect(result.skipped).toEqual({ table: 1 });
  });

  it("keeps the slide and counts the image when an upload fails", async () => {
    const upload = vi.fn(async (file: File) => {
      if (file.name.startsWith("slide-2")) throw new Error("Too big");
      return "/api/upload/raw?key=uploads/ok.png";
    });
    const progress = vi.fn();
    const result = await uploadImages(planOf(png("a"), png("b")), upload, progress);
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0].image?.src).toBe("/api/upload/raw?key=uploads/ok.png");
    expect(result.slides[1].image).toBeNull();
    expect(result.skipped).toEqual({ table: 1, image: 1 });
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it("does not run more than four uploads at once", async () => {
    let live = 0;
    let peak = 0;
    const upload = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return "/u";
    };
    await uploadImages(planOf(...Array.from({ length: 10 }, (_, i) => png(`img${i}`))), upload);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("importSummary", () => {
  it("reports what was added and what couldn't be imported", () => {
    expect(importSummary(1, {})).toBe("Added 1 slide.");
    expect(importSummary(12, { table: 1, chart: 2 })).toBe("Added 12 slides. 3 items couldn't be imported (1 tables, 2 charts).");
    expect(importSummary(2, { diagram: 1 })).toBe("Added 2 slides. 1 item couldn't be imported (1 SmartArt diagrams).");
  });
});

describe("parsePptxFile", () => {
  const fileOf = () => new File([new Uint8Array([1, 2, 3])], "deck.pptx");

  it("maps what pptxtojson returns", async () => {
    vi.resetModules();
    vi.doMock("pptxtojson", () => ({
      parse: vi.fn(async () => ({ size: { width: 960, height: 540 }, slides: [{ elements: [], layoutElements: [], note: "n", fill: {} }] })),
    }));
    const { parsePptxFile: parse } = await import("../import-client");
    const plan = await parse(fileOf());
    expect(plan.slides).toHaveLength(1);
    expect(plan.slides[0].notes).toBe("n");
    vi.doUnmock("pptxtojson");
  });

  it("reports unreadable, empty and oversized presentations", async () => {
    vi.resetModules();
    const parse = vi.fn();
    vi.doMock("pptxtojson", () => ({ parse }));
    const { parsePptxFile: run, PptxImportError: Err } = await import("../import-client");
    parse.mockRejectedValueOnce(new Error("bad zip"));
    await expect(run(fileOf())).rejects.toThrow(Err);
    parse.mockResolvedValueOnce({ size: { width: 960, height: 540 }, slides: [] });
    await expect(run(fileOf())).rejects.toThrow(/any slides/);
    parse.mockResolvedValueOnce({ size: { width: 960, height: 540 }, slides: Array.from({ length: MAX_PPTX_SLIDES + 1 }, () => ({ elements: [], note: "" })) });
    await expect(run(fileOf())).rejects.toThrow(/more than/);
    vi.doUnmock("pptxtojson");
  });
});

describe("pending import hand-off", () => {
  it("applies once: reading clears it", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    expect(stashImport("p1", { slides: [ready()], skipped: { chart: 1 } })).toBe(true);
    expect(takeImport("p2")).toBeNull();
    expect(takeImport("p1")).toMatchObject({ skipped: { chart: 1 } });
    expect(takeImport("p1")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("reports when the browser won't hold the import", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    });
    expect(stashImport("p1", { slides: [], skipped: {} })).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("free items", () => {
  const placed = (z: number, over: Record<string, number> = {}) => ({ x: 100, y: 200, w: 300, h: 80, rot: 0, z, ...over });

  it("writes free text, images and shapes as slotless elements and moves slot elements to their place", () => {
    const doc = newDeck();
    const [id] = appendSlides(doc, [
      ready({
        layoutId: "content",
        placements: { title: placed(2, { x: 50 }), body: placed(3) },
        free: [
          { kind: "shape", shape: "ellipse", fill: "muted", placed: placed(1) },
          { kind: "text", textStyle: "heading", blocks: [para("Callout")], placed: placed(4, { rot: 5 }) },
          { kind: "image", src: "https://x/a.png", alt: "a", placed: placed(5) },
        ],
      }),
    ]);
    const slide = readDeck(doc).slides.find((s) => s.id === id)!;
    const byId = new Map(slide.elements.map((e) => [e.id, e]));
    expect(byId.get("title")).toMatchObject({ slot: "title", x: 50, y: 200, w: 300, h: 80, z: 2 });
    expect(byId.get("body")).toMatchObject({ slot: "body", z: 3 });
    const free = slide.elements.filter((e) => e.slot === null);
    expect(free.map((e) => e.kind).sort()).toEqual(["image", "shape", "text"]);
    expect(free.find((e) => e.kind === "text")).toMatchObject({ textStyle: "heading", rot: 5, text: "Callout", z: 4 });
    expect(free.find((e) => e.kind === "image")).toMatchObject({ src: "https://x/a.png", alt: "a" });
    expect(free.find((e) => e.kind === "shape")).toMatchObject({ shape: "ellipse", fill: "muted", z: 1 });
  });

  it("leaves slot elements unplaced when the slide has no placements", () => {
    const doc = newDeck();
    const [id] = appendSlides(doc, [ready()]);
    const title = readDeck(doc).slides.find((s) => s.id === id)!.elements.find((e) => e.id === "title")!;
    expect(title.x).toBeUndefined();
  });

  it("uploads free images with the rest and counts the ones that fail", async () => {
    const png = (name: string) => ({ dataUrl: `data:image/png;base64,${btoa(name)}`, alt: "", name });
    const plan: ImportPlan = {
      slides: [
        {
          ...ready({ image: null }),
          image: png("hero"),
          free: [
            { kind: "image", placed: placed(1), ...png("one") },
            { kind: "image", placed: placed(2), ...png("two") },
            { kind: "shape", shape: "rect", fill: "accent", placed: placed(3) },
          ],
        },
      ],
      skipped: {},
    };
    const upload = vi.fn(async (file: File) => {
      if (file.name.includes("two")) throw new Error("nope");
      return `/uploads/${file.name}`;
    });
    const out = await uploadImages(plan, upload);
    expect(out.slides[0].image?.src).toContain("/uploads/");
    const kinds = out.slides[0].free!.map((f) => f.kind);
    expect(kinds).toEqual(["image", "shape"]);
    expect(out.skipped.image).toBe(1);
  });
});

describe("writeBlocks tables and code", () => {
  const read = (blocks: ImportBlock[]) => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("f");
    writeBlocks(fragment, blocks);
    return fragmentToBlocks(fragment);
  };
  const text = (t: string, styles: Record<string, boolean> = {}) => [{ type: "text" as const, text: t, styles }];

  it("writes a table the server reader decodes with its header row and cell text", () => {
    const [table] = read([
      { type: "table", content: [], children: [], table: { header: true, rows: [[text("A"), text("B", { bold: true })], [text("1"), []]] } },
    ]);
    const content = table.content as unknown as { headerRows?: number; rows: Array<{ cells: Array<{ content: Array<{ text: string; styles: Record<string, boolean> }> }> }> };
    expect(table.type).toBe("table");
    expect(content.headerRows).toBe(1);
    expect(content.rows).toHaveLength(2);
    expect(content.rows[0].cells.map((c) => c.content[0].text)).toEqual(["A", "B"]);
    expect(content.rows[0].cells[1].content[0].styles).toEqual({ bold: true });
    expect(content.rows[1].cells[1].content).toEqual([]);
  });

  it("writes a table without a header row when asked", () => {
    const [table] = read([{ type: "table", content: [], children: [], table: { header: false, rows: [[text("A")]] } }]);
    expect((table.content as unknown as { headerRows?: number }).headerRows ?? 0).toBe(0);
  });

  it("writes a code block with its language and text", () => {
    const [code] = read([{ type: "codeBlock", content: text("const a = 1;"), children: [], language: "typescript" }]);
    expect(code.type).toBe("codeBlock");
    expect(code.props.language).toBe("typescript");
    expect((code.content as Array<{ text: string }>)[0].text).toBe("const a = 1;");
  });
});
