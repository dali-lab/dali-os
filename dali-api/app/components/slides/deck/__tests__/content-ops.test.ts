import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readDeck, toRenderDeck } from "~/collab/read-deck.server";
import { CLIP_MARK, CLIP_VERSION, MAX_TABLE_COLS, MAX_TABLE_ROWS, parseClipboard, serializeSelection } from "../clipboard";
import { addSlide, slideFragment } from "../deck-ops";
import { buildSteps } from "../builds";
import { placedElements } from "../freeform";
import { duplicateElements, groupElements, moveElements, setPlacements, deleteElements } from "../freeform-ops";
import { addChart, addCodeBlock, addEmoji, addIcon, addTable, addTextBox, addVideo, pasteItems, setChart, setFill, setIconName, setVideoUrl } from "../freeform-ops";
import { elementsOf, initDeck, slidesMap } from "../model";
import { snapshotDeck, type RenderSlide } from "../snapshot";
import { fragmentToRichDoc } from "../fragment-blocks";
import { DECK_CREATE, DECK_LOCAL } from "../deck-ops";

const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function setup() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  return { doc, slideId };
}
const snap = (doc: Y.Doc, slideId: string): RenderSlide => snapshotDeck(doc).slides.find((s) => s.id === slideId)!;
const el = (doc: Y.Doc, slideId: string, id: string) => snap(doc, slideId).elements.find((e) => e.id === id)!;

describe("inserting content", () => {
  it("adds a table as a free text box holding a header row and empty cells", () => {
    const { doc, slideId } = setup();
    const id = addTable(doc, slideId, undefined, 3, 4)!;
    const e = el(doc, slideId, id);
    expect(e).toMatchObject({ kind: "text", slot: null });
    const table = (e.blocks as unknown as Array<{ type: string; content: { headerRows?: number; rows: Array<{ cells: unknown[] }> } }>)[0];
    expect(table.type).toBe("table");
    expect(table.content.headerRows).toBe(1);
    expect(table.content.rows).toHaveLength(3);
    expect(table.content.rows.every((r) => r.cells.length === 4)).toBe(true);
  });

  it("writes tables the server codec and the editor read the same way", () => {
    const { doc, slideId } = setup();
    const id = addTable(doc, slideId, undefined, 2, 2)!;
    const server = readDeck(doc).slides[0].elements.find((e) => e.id === id)!.blocks;
    const table = server.find((b) => b.type === "table")!;
    const content = table.content as unknown as { headerRows?: number; rows: unknown[] };
    expect(content.rows).toHaveLength(2);
    expect(content.headerRows).toBe(1);
  });

  it("clamps table size", () => {
    const { doc, slideId } = setup();
    const id = addTable(doc, slideId, undefined, 999, 999)!;
    const table = (el(doc, slideId, id).blocks as unknown as Array<{ content: { rows: Array<{ cells: unknown[] }> } }>)[0];
    expect(table.content.rows.length).toBe(50);
    expect(table.content.rows[0].cells.length).toBe(20);
  });

  it("adds a code block as a free text box", () => {
    const { doc, slideId } = setup();
    const id = addCodeBlock(doc, slideId)!;
    expect(el(doc, slideId, id).blocks[0]).toMatchObject({ type: "codeBlock" });
    expect(readDeck(doc).slides[0].elements.find((e) => e.id === id)!.blocks[0].type).toBe("codeBlock");
  });

  it("adds an emoji as large text and refuses empty or long input", () => {
    const { doc, slideId } = setup();
    const id = addEmoji(doc, slideId, "🚀")!;
    const e = el(doc, slideId, id);
    expect(e).toMatchObject({ kind: "text", textStyle: "title" });
    expect(JSON.stringify(e.blocks)).toContain("🚀");
    expect(addEmoji(doc, slideId, "  ")).toBeNull();
    expect(addEmoji(doc, slideId, "x".repeat(40))).toBeNull();
  });

  it("adds a chart with sample data, centered", () => {
    const { doc, slideId } = setup();
    const id = addChart(doc, slideId, "pie")!;
    const e = el(doc, slideId, id);
    expect(e).toMatchObject({ kind: "chart", slot: null, x: 480, y: 270, w: 960, h: 540 });
    expect(e.chart?.type).toBe("pie");
    expect(e.chart?.data.series[0].values.length).toBe(e.chart?.data.labels.length);
  });

  it("adds an icon and a video, and refuses ones the sets and registry do not know", () => {
    const { doc, slideId } = setup();
    const icon = addIcon(doc, slideId, "rocket", { x: 300, y: 300 })!;
    expect(el(doc, slideId, icon)).toMatchObject({ kind: "icon", icon: "rocket", fill: "accent" });
    expect(addIcon(doc, slideId, "nope")).toBeNull();
    const video = addVideo(doc, slideId, YT)!;
    expect(el(doc, slideId, video)).toMatchObject({ kind: "video", videoUrl: YT });
    expect(addVideo(doc, slideId, "https://example.com/movie")).toBeNull();
    expect(snap(doc, slideId).elements).toHaveLength(2);
  });

  it("places new elements above the others", () => {
    const { doc, slideId } = setup();
    const t = addTextBox(doc, slideId)!;
    const c = addChart(doc, slideId)!;
    expect(el(doc, slideId, c).z).toBeGreaterThan(el(doc, slideId, t).z);
  });

  it("uses the creation origin for elements with new text and the local origin for the rest", () => {
    const { doc, slideId } = setup();
    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));
    addTable(doc, slideId);
    addChart(doc, slideId);
    expect(origins).toEqual([DECK_CREATE, DECK_LOCAL]);
  });
});

describe("editing content", () => {
  it("replaces chart data and ignores a bad chart", () => {
    const { doc, slideId } = setup();
    const id = addChart(doc, slideId)!;
    const next = { type: "line" as const, data: { labels: ["A", "B"], series: [{ name: "S", values: [3, 4] }] } };
    setChart(doc, slideId, id, next);
    expect(el(doc, slideId, id).chart).toEqual(next);
    setChart(doc, slideId, id, { type: "line", data: { labels: ["A"], series: [{ name: "S", values: [Number.NaN] }] } });
    expect(el(doc, slideId, id).chart).toEqual(next);
  });

  it("swaps an icon and recolors it", () => {
    const { doc, slideId } = setup();
    const id = addIcon(doc, slideId, "star")!;
    setIconName(doc, slideId, id, "heart");
    setFill(doc, slideId, [id], "fg");
    expect(el(doc, slideId, id)).toMatchObject({ icon: "heart", fill: "fg" });
    setIconName(doc, slideId, id, "nope");
    expect(el(doc, slideId, id).icon).toBe("heart");
  });

  it("changes a video link only to a supported one", () => {
    const { doc, slideId } = setup();
    const id = addVideo(doc, slideId, YT)!;
    expect(setVideoUrl(doc, slideId, id, "https://youtu.be/aaaaaaaaaaa")).toBe(true);
    expect(el(doc, slideId, id).videoUrl).toBe("https://youtu.be/aaaaaaaaaaa");
    expect(setVideoUrl(doc, slideId, id, "https://example.com")).toBe(false);
    expect(el(doc, slideId, id).videoUrl).toBe("https://youtu.be/aaaaaaaaaaa");
  });

  it("does not edit an element of another kind", () => {
    const { doc, slideId } = setup();
    const id = addIcon(doc, slideId, "star")!;
    setChart(doc, slideId, id, { type: "bar", data: { labels: ["A"], series: [{ name: "S", values: [1] }] } });
    expect(el(doc, slideId, id).chart).toBeUndefined();
  });
});

describe("old clients", () => {
  it("snapshot an unknown kind as a plain element they do not draw", () => {
    const { doc, slideId } = setup();
    const m = new Y.Map<unknown>();
    m.set("id", "x");
    m.set("kind", "hologram");
    m.set("z", 5);
    m.set("deleted", false);
    elementsOf(slidesMap(doc).get(slideId)!).set("x", m);
    expect(el(doc, slideId, "x").kind).toBe("hologram");
  });
});

describe("clipboard", () => {
  const roundTrip = (doc: Y.Doc, slideId: string, ids: string[]) => parseClipboard(serializeSelection(snap(doc, slideId), ids)!)!;

  it("copies and pastes charts, icons and videos", () => {
    const { doc, slideId } = setup();
    const chart = addChart(doc, slideId, "line")!;
    const icon = addIcon(doc, slideId, "rocket")!;
    const video = addVideo(doc, slideId, YT)!;
    const items = roundTrip(doc, slideId, [chart, icon, video]);
    expect(items.map((i) => i.kind).sort()).toEqual(["chart", "icon", "video"]);
    const pasted = pasteItems(doc, slideId, items);
    expect(pasted).toHaveLength(3);
    const kinds = pasted.map((id) => el(doc, slideId, id));
    expect(kinds.find((k) => k.kind === "chart")?.chart?.type).toBe("line");
    expect(kinds.find((k) => k.kind === "icon")?.icon).toBe("rocket");
    expect(kinds.find((k) => k.kind === "video")?.videoUrl).toBe(YT);
  });

  it("copies and pastes tables and code blocks inside text boxes", () => {
    const { doc, slideId } = setup();
    const table = addTable(doc, slideId, undefined, 2, 3)!;
    const code = addCodeBlock(doc, slideId)!;
    const pasted = pasteItems(doc, slideId, roundTrip(doc, slideId, [table, code]));
    const blocks = pasted.map((id) => el(doc, slideId, id).blocks[0] as unknown as { type: string; content: { rows?: Array<{ cells: unknown[] }>; headerRows?: number } });
    const pastedTable = blocks.find((b) => b.type === "table")!;
    expect(pastedTable.content.rows).toHaveLength(2);
    expect(pastedTable.content.headerRows).toBe(1);
    expect(blocks.some((b) => b.type === "codeBlock")).toBe(true);
  });

  const item = (extra: Record<string, unknown>) => JSON.stringify({ mark: CLIP_MARK, v: CLIP_VERSION, items: [{ key: "a", placed: { x: 0, y: 0, w: 100, h: 100, rot: 0 }, ...extra }] });

  it("drops charts with non-finite or oversized data", () => {
    const bad = { type: "bar", data: { labels: ["A"], series: [{ name: "S", values: [1e999] }] } };
    expect(parseClipboard(item({ kind: "chart", chart: bad }))).toBeNull();
    expect(parseClipboard(item({ kind: "chart", chart: { type: "bar", data: { labels: Array(100).fill("x"), series: [{ name: "S", values: [] }] } } }))).toBeNull();
    expect(parseClipboard(item({ kind: "chart", chart: { type: "bar" } }))).toBeNull();
  });

  it("drops icons outside the set and videos outside the registry", () => {
    expect(parseClipboard(item({ kind: "icon", icon: "../../etc" }))).toBeNull();
    expect(parseClipboard(item({ kind: "video", videoUrl: "https://example.com/v" }))).toBeNull();
    expect(parseClipboard(item({ kind: "video", videoUrl: "javascript:alert(1)" }))).toBeNull();
  });

  it("limits table size and reads only known code languages characters", () => {
    const row = { cells: Array.from({ length: MAX_TABLE_COLS + 10 }, () => [{ type: "text", text: "x", styles: {} }]) };
    const rows = Array.from({ length: MAX_TABLE_ROWS + 10 }, () => row);
    const parsed = parseClipboard(item({ kind: "text", blocks: [{ type: "table", content: { type: "tableContent", rows } }, { type: "codeBlock", props: { language: "<script>" }, content: [{ type: "text", text: "a", styles: {} }] }] }))!;
    const table = parsed[0].blocks![0].table!;
    expect(table.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(table.rows[0]).toHaveLength(MAX_TABLE_COLS);
    expect(parsed[0].blocks![1].language).toBe("text");
  });
});

describe("reading a deck for export and view", () => {
  it("carries chart, icon and video fields through the server read", () => {
    const { doc, slideId } = setup();
    addChart(doc, slideId);
    addIcon(doc, slideId, "star");
    addVideo(doc, slideId, YT);
    const read = readDeck(doc);
    expect(read.slides[0].elements.map((e) => e.kind).sort()).toEqual(["chart", "icon", "video"]);
    const render = toRenderDeck(read);
    expect(render.slides[0].elements.find((e) => e.kind === "chart")?.chart?.type).toBe("bar");
    expect(render.slides[0].elements.find((e) => e.kind === "icon")?.icon).toBe("star");
    expect(render.slides[0].elements.find((e) => e.kind === "video")?.videoUrl).toBe(YT);
  });

  it("the editor-side table read matches the server read", () => {
    const { doc, slideId } = setup();
    const id = addTable(doc, slideId, undefined, 2, 2)!;
    const client = fragmentToRichDoc(slideFragment(doc, slideId, id)) as unknown as Array<{ type: string }>;
    expect(client[0].type).toBe("table");
  });
});

describe("working with content like any other element", () => {
  it("lets charts, icons and videos be placed, moved, resized, rotated, grouped, duplicated and deleted", () => {
    const { doc, slideId } = setup();
    const chart = addChart(doc, slideId)!;
    const icon = addIcon(doc, slideId, "star")!;
    const video = addVideo(doc, slideId, YT)!;
    expect(placedElements(snap(doc, slideId)).map((p) => p.element.kind).sort()).toEqual(["chart", "icon", "video"]);
    moveElements(doc, slideId, [chart], 50, 20);
    expect(el(doc, slideId, chart)).toMatchObject({ x: 530, y: 290 });
    setPlacements(doc, slideId, { [icon]: { x: 10, y: 20, w: 100, h: 100, rot: 30 } });
    expect(el(doc, slideId, icon)).toMatchObject({ x: 10, y: 20, w: 100, h: 100, rot: 30 });
    const group = groupElements(doc, slideId, [chart, icon, video])!;
    expect(snap(doc, slideId).elements.find((e) => e.id === group)?.children).toHaveLength(3);
    const copies = duplicateElements(doc, slideId, [chart, video]);
    expect(copies).toHaveLength(2);
    const copied = snap(doc, slideId).elements.filter((e) => copies.includes(e.id));
    expect(copied.map((c) => c.kind).sort()).toEqual(["chart", "video"]);
    expect(copied.find((c) => c.kind === "chart")?.chart).toEqual(el(doc, slideId, chart).chart);
    expect(copied.find((c) => c.kind === "video")?.videoUrl).toBe(YT);
    expect(deleteElements(doc, slideId, [chart, icon, video])).toHaveLength(3);
    expect(snap(doc, slideId).elements.filter((e) => ["chart", "icon", "video"].includes(e.kind) && !copies.includes(e.id))).toHaveLength(0);
  });

  it("builds in on a step like other elements", () => {
    const { doc, slideId } = setup();
    const id = addChart(doc, slideId)!;
    elementsOf(slidesMap(doc).get(slideId)!).get(id)!.set("build", 2);
    expect(buildSteps(snap(doc, slideId))).toBe(2);
  });
});
