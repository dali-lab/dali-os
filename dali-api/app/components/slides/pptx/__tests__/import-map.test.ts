import type { Element, Image, Shape, Slide, Text } from "pptxtojson";
import { describe, expect, it } from "vitest";
import { blocksText, parseTextHtml } from "../import-html";
import { mapPresentation } from "../import-map";

const SIZE = { width: 960, height: 540 };
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const span = (text: string, style = "font-size: 18pt;") => `<span style="${style}">${text.replace(/ /g, "&nbsp;")}</span>`;
const p = (inner: string) => `<p style="text-align: left;">${inner}</p>`;

const text = (name: string, content: string, box: Partial<Text> = {}, order = 1): Text =>
  ({ type: "text", id: name, name, left: 40, top: 40, width: 800, height: 80, content, order, ...box }) as unknown as Text;
const shape = (name: string, content: string, box: Partial<Shape> = {}, order = 1): Shape =>
  ({ type: "shape", id: name, name, left: 40, top: 200, width: 800, height: 200, content, order, ...box }) as unknown as Shape;
const image = (box: Partial<Image> = {}, order = 5): Image =>
  ({ type: "image", id: "img", left: 500, top: 100, width: 400, height: 300, base64: PIXEL, order, ...box }) as unknown as Image;
const slide = (elements: Element[], note = ""): Slide => ({ fill: { type: "color", value: "#fff" }, elements, layoutElements: [], note }) as unknown as Slide;

const map = (slides: Slide[]) => mapPresentation({ slides, size: SIZE });

describe("parseTextHtml", () => {
  it("reads runs with bold, italic, underline, strike and links", () => {
    const html = p(
      span("plain ") +
        span("bold", "font-weight: bold;") +
        span(" it", "font-style: italic;") +
        span(" u", "text-decoration: underline;") +
        span(" s", "text-decoration-line: line-through;") +
        `<span style=""><a href="https://example.edu/x?a=1&amp;b=2" target="_blank">link</a></span>`,
    );
    const [block] = parseTextHtml(html).blocks;
    const flat = block.content.map((c) => (c.type === "link" ? { link: c.href, text: c.content![0].text } : { text: c.text, styles: c.styles }));
    expect(flat).toEqual([
      { text: "plain ", styles: {} },
      { text: "bold", styles: { bold: true } },
      { text: " it", styles: { italic: true } },
      { text: " u", styles: { underline: true } },
      { text: " s", styles: { strike: true } },
      { link: "https://example.edu/x?a=1&b=2", text: "link" },
    ]);
  });

  it("nests list levels and keeps bullet and numbered types", () => {
    const html = `<ul><li>${p(span("one"))}</li><ul><li>${p(span("one a"))}</li></ul><li>${p(span("two"))}</li></ul><ol><li>${p(span("step"))}</li></ol>`;
    const { blocks } = parseTextHtml(html);
    expect(blocks.map((b) => b.type)).toEqual(["bulletListItem", "bulletListItem", "numberedListItem"]);
    expect(blocksText(blocks[0].children)).toBe("one a");
    expect(blocksText(blocks)).toBe("one\none a\ntwo\nstep");
  });

  it("drops paragraphs with no text and reports the largest font size", () => {
    const parsed = parseTextHtml(p(span("", "font-size: 12pt;")) + p("&nbsp;") + p(span("Big", "font-size: 44pt;")) + p(span("Small")));
    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.maxFontPt).toBe(44);
  });

  it("decodes entities", () => {
    expect(blocksText(parseTextHtml(p("a&nbsp;&amp;&nbsp;b &lt;c&gt; &#38; &#x26;")).blocks)).toBe("a & b <c> & &");
  });
});

describe("mapPresentation layouts", () => {
  it("maps a title and subtitle placeholder on the first slide to the title layout", () => {
    const [s] = map([slide([text("Title 1", p(span("Welcome", "font-size: 44pt;"))), text("Subtitle 2", p(span("Fall kickoff")), { top: 200 })])]).slides;
    expect(s.layoutId).toBe("title");
    expect(blocksText(s.title)).toBe("Welcome");
    expect(blocksText(s.subtitle)).toBe("Fall kickoff");
    expect(s.body).toEqual([]);
  });

  it("maps title plus a content placeholder to the content layout, keeping bullets", () => {
    const body = `<ul><li>${p(span("First"))}</li><li>${p(span("Second"))}</li></ul>`;
    const [s] = map([slide([text("Title 1", p(span("Plan"))), shape("Content Placeholder 2", body)]), slide([])]).slides;
    expect(s.layoutId).toBe("content");
    expect(blocksText(s.title)).toBe("Plan");
    expect(s.body.map((b) => b.type)).toEqual(["bulletListItem", "bulletListItem"]);
  });

  it("falls back to position and size when shapes are not named as placeholders", () => {
    const [s] = map([
      slide([
        text("TextBox 5", p(span("Body copy here")), { top: 300 }, 2),
        text("TextBox 6", p(span("Headline", "font-size: 40pt;")), { top: 30 }, 1),
      ]),
    ]).slides;
    expect(blocksText(s.title)).toBe("Headline");
    expect(blocksText(s.subtitle)).toBe("Body copy here");
  });

  it("sends a full-slide picture to the image layout with the title as caption", () => {
    const [, s] = map([slide([]), slide([image({ left: 0, top: 0, width: 960, height: 540 }), text("Title 1", p(span("Team photo")))])]).slides;
    expect(s.layoutId).toBe("image");
    expect(blocksText(s.title)).toBe("Team photo");
    expect(s.image?.dataUrl).toBe(PIXEL);
  });

  it("sends text beside a smaller picture to the split layout and folds a subtitle into the body", () => {
    const [, s] = map([
      slide([]),
      slide([text("Title 1", p(span("Results"))), text("Subtitle 2", p(span("Q3")), { top: 150 }), shape("Content Placeholder 3", p(span("Up 12 percent")), { top: 250 }), image()]),
    ]).slides;
    expect(s.layoutId).toBe("split");
    expect(blocksText(s.body)).toBe("Q3\nUp 12 percent");
    expect(s.subtitle).toEqual([]);
  });

  it("uses the big number layout for a numeric title with a label", () => {
    const [, s] = map([slide([]), slide([text("Title 1", p(span("42%", "font-size: 96pt;"))), text("Subtitle 2", p(span("of members")), { top: 200 })])]).slides;
    expect(s.layoutId).toBe("bignumber");
  });

  it("uses the section layout for a lone title after the first slide", () => {
    const [, s] = map([slide([]), slide([text("Title 1", p(span("Part two")))])]).slides;
    expect(s.layoutId).toBe("section");
  });

  it("flattens grouped text and carries speaker notes", () => {
    const group = { type: "group", id: "g", left: 0, top: 0, width: 960, height: 540, rotate: 0, order: 3, isFlipH: false, isFlipV: false, elements: [shape("Content Placeholder 2", p(span("Inside a group")))] } as unknown as Element;
    const [s] = map([slide([group], "  Say this out loud\n")]).slides;
    expect(s.layoutId).toBe("content");
    expect(blocksText(s.body)).toBe("Inside a group");
    expect(s.notes).toBe("Say this out loud");
  });

  it("ignores shapes without text and keeps the deck's slide order", () => {
    const { slides } = map([
      slide([shape("Rectangle 1", "")]),
      slide([text("Title 1", p(span("Two")))]),
      slide([text("Title 1", p(span("Three")))]),
    ]);
    expect(slides.map((s) => blocksText(s.title))).toEqual(["", "Two", "Three"]);
  });
});

describe("mapPresentation unsupported elements", () => {
  const unsupported = (type: string, order: number) => ({ type, id: type, left: 0, top: 0, width: 100, height: 100, order }) as unknown as Element;

  it("counts tables, charts, diagrams, media and equations instead of dropping them silently", () => {
    const plan = map([
      slide([unsupported("table", 1), unsupported("chart", 2), unsupported("chart", 3), unsupported("diagram", 4), unsupported("video", 5), unsupported("audio", 6), unsupported("math", 7)]),
    ]);
    expect(plan.skipped).toEqual({ table: 1, chart: 2, diagram: 1, video: 1, audio: 1, math: 1 });
  });

  it("keeps the biggest picture and counts the rest", () => {
    const plan = map([slide([image({ width: 100, height: 100 }), image({ width: 300, height: 300, id: "big" }), image({ width: 50, height: 50, id: "tiny" })])]);
    expect(plan.slides[0].image).not.toBeNull();
    expect(plan.skipped).toEqual({ image: 2 });
  });

  it("counts a picture whose bytes were not read", () => {
    const plan = map([slide([image({ base64: "" })])]);
    expect(plan.slides[0].image).toBeNull();
    expect(plan.skipped).toEqual({ image: 1 });
  });
});
