import { describe, expect, it } from "vitest";
import { CLIP_MARK, CLIP_VERSION, importBlocksOf, parseClipboard, safeImageUrl, serializeSelection } from "../clipboard";
import type { RenderElement, RenderSlide } from "../snapshot";

const para = (text: string, styles: Record<string, boolean> = {}) => ({ id: "b", type: "paragraph", props: {}, content: [{ type: "text", text, styles }], children: [] });
const base = { slot: null, z: 1, src: null, alt: null, textStyle: null, blocks: [] as never };
const slide = (elements: Array<Partial<RenderElement> & { id: string; kind: string }>): RenderSlide => ({
  id: "s",
  pos: 1,
  layoutId: "content",
  elements: elements.map((e) => ({ ...base, ...e })) as RenderElement[],
});
const payload = (items: unknown[], over: Record<string, unknown> = {}) => JSON.stringify({ mark: CLIP_MARK, v: CLIP_VERSION, items, ...over });
const placed = { x: 10, y: 20, w: 300, h: 100, rot: 0 };

describe("serializeSelection", () => {
  it("round-trips text, image, shape and group through the clipboard text", () => {
    const s = slide([
      { id: "t", kind: "text", x: 10, y: 20, w: 300, h: 100, blocks: [para("hi", { bold: true })] as never, textStyle: "heading" },
      { id: "i", kind: "image", x: 0, y: 0, w: 50, h: 50, src: "https://x/y.png", alt: "y" },
      { id: "r", kind: "shape", x: 5, y: 5, w: 80, h: 80, rot: 30, shape: "ellipse", fill: "muted" },
      { id: "g", kind: "group", children: ["t", "i"] },
    ]);
    const text = serializeSelection(s, ["g", "r"])!;
    const items = parseClipboard(text)!;
    expect(items.map((i) => i.kind).sort()).toEqual(["group", "image", "shape", "text"]);
    const t = items.find((i) => i.kind === "text")!;
    expect(t).toMatchObject({ textStyle: "heading", blocks: [{ type: "paragraph", content: [{ type: "text", text: "hi", styles: { bold: true } }] }] });
    expect(items.find((i) => i.kind === "shape")).toMatchObject({ shape: "ellipse", fill: "muted", placed: { rot: 30 } });
    expect(items.find((i) => i.kind === "group")!.children).toEqual(["t", "i"]);
  });

  it("copies a slot element as a text item at its slot's place", () => {
    const s = slide([{ id: "title", kind: "text", slot: "title" }]);
    const items = parseClipboard(serializeSelection(s, ["title"])!)!;
    expect(items[0].placed).toMatchObject({ x: 160, y: 110, w: 1600, h: 150 });
  });

  it("returns null when nothing copyable is selected", () => {
    expect(serializeSelection(slide([]), ["x"])).toBeNull();
  });

  it("flattens rich blocks to the supported subset", () => {
    const blocks = importBlocksOf([{ type: "checkListItem", content: [{ type: "text", text: "a", styles: { bold: true, code: true } }], children: [] }, { type: "callout", content: [], children: [] }, { type: "codeBlock", content: [], props: { language: "ts" }, children: [] }]);
    expect(blocks.map((b) => b.type)).toEqual(["bulletListItem", "paragraph", "codeBlock"]);
    expect(blocks[2].language).toBe("ts");
    expect(blocks[0].content).toEqual([{ type: "text", text: "a", styles: { bold: true } }]);
  });
});

describe("parseClipboard sanitizing", () => {
  it("rejects text that is not ours", () => {
    expect(parseClipboard("hello")).toBeNull();
    expect(parseClipboard("{not json")).toBeNull();
    expect(parseClipboard(JSON.stringify({ mark: "other", v: 1, items: [] }))).toBeNull();
    expect(parseClipboard(payload([], { v: 2 }))).toBeNull();
    expect(parseClipboard(payload([]))).toBeNull();
  });

  it("only takes images by http, https or a site path", () => {
    expect(safeImageUrl("https://x/y.png")).toBe("https://x/y.png");
    expect(safeImageUrl("/uploads/a.png")).toBe("/uploads/a.png");
    for (const bad of ["data:image/png;base64,AAAA", "javascript:alert(1)", "//evil.test/x.png", "file:///etc/passwd", "", 4, null]) {
      expect(safeImageUrl(bad)).toBeNull();
    }
    const items = parseClipboard(payload([{ key: "a", kind: "image", placed, src: "data:image/png;base64,AAAA" }, { key: "b", kind: "image", placed, src: "https://x/ok.png", alt: "ok" }]))!;
    expect(items.map((i) => i.key)).toEqual(["b"]);
  });

  it("drops unknown kinds and items with bad geometry", () => {
    const items = parseClipboard(
      payload([
        { key: "a", kind: "iframe", placed },
        { key: "b", kind: "shape", placed: { ...placed, w: "wide" } },
        { key: "c", kind: "shape", placed: { ...placed, x: null } },
        { key: "d", kind: "shape", placed },
      ]),
    )!;
    expect(items.map((i) => i.key)).toEqual(["d"]);
  });

  it("clamps geometry and rotation and falls back from unknown shape and fill", () => {
    const [item] = parseClipboard(payload([{ key: "a", kind: "shape", shape: "blob", fill: "hotpink", placed: { x: -1e9, y: 1e9, w: 1e9, h: -5, rot: 9999 } }]))!;
    expect(item.shape).toBe("rect");
    expect(item.fill).toBeUndefined();
    expect(item.placed.x).toBeGreaterThanOrEqual(-3840);
    expect(item.placed.y).toBeLessThanOrEqual(5760);
    expect(item.placed.w).toBeLessThanOrEqual(7680);
    expect(item.placed.h).toBe(1);
    expect(item.placed.rot).toBe(360);
  });

  it("keeps only known text marks and safe link targets, and drops unknown block types", () => {
    const blocks = [
      {
        type: "scriptBlock",
        content: [
          { type: "text", text: "hi", styles: { bold: true, onclick: true, color: "red" } },
          { type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "bad", styles: {} }] },
          { type: "link", href: "https://ok.test", content: [{ type: "text", text: "good", styles: {} }] },
          { type: "mention", props: { x: 1 } },
        ],
        children: [],
      },
    ];
    const [item] = parseClipboard(payload([{ key: "t", kind: "text", placed, blocks, textStyle: "huge" }]))!;
    expect(item.textStyle).toBeUndefined();
    const [b] = item.blocks!;
    expect(b.type).toBe("paragraph");
    expect(b.content).toEqual([
      { type: "text", text: "hi", styles: { bold: true } },
      { type: "text", text: "bad", styles: {} },
      { type: "link", href: "https://ok.test", content: [{ type: "text", text: "good", styles: {} }] },
    ]);
  });

  it("caps text length and nesting depth", () => {
    const long = "x".repeat(50_000);
    let nested: unknown[] = [];
    for (let i = 0; i < 10; i++) nested = [{ type: "paragraph", content: [{ type: "text", text: "n", styles: {} }], children: nested }];
    const [item] = parseClipboard(payload([{ key: "t", kind: "text", placed, blocks: [{ type: "paragraph", content: [{ type: "text", text: long, styles: {} }], children: [] }] }, ]))!;
    expect(item.blocks![0].content[0].text!.length).toBe(20_000);
    const [deep] = parseClipboard(payload([{ key: "t", kind: "text", placed, blocks: nested }]))!;
    let depth = 0;
    for (let b = deep.blocks![0]; b; b = b.children[0]) depth++;
    expect(depth).toBeLessThanOrEqual(4);
  });

  it("ignores duplicate keys, group children that are not in the payload and one-child groups", () => {
    const items = parseClipboard(
      payload([
        { key: "a", kind: "shape", placed },
        { key: "a", kind: "shape", placed },
        { key: "b", kind: "shape", placed },
        { key: "g", kind: "group", placed, children: ["a", "b", "zzz"] },
        { key: "h", kind: "group", placed, children: ["a"] },
      ]),
    )!;
    expect(items.filter((i) => i.key === "a")).toHaveLength(1);
    expect(items.find((i) => i.key === "g")!.children).toEqual(["a", "b"]);
    expect(items.some((i) => i.key === "h")).toBe(false);
  });
});
