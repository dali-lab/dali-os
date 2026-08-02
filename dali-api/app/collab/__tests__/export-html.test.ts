import { describe, it, expect } from "vitest";
import { renderNodes } from "../export-html";
import { renderBlocksToPdf } from "../export-pdf";
import type { DocBlock } from "../blocknote-server";

describe("renderNodes — image", () => {
  it("renders align + width so a resized/floated image survives export", () => {
    const html = renderNodes([
      {
        type: "image",
        attrs: { src: "/api/upload/raw?key=x", alt: "Chart", align: "left", width: 300 },
      },
    ]);
    expect(html).toContain('src="/api/upload/raw?key=x"');
    expect(html).toContain('alt="Chart"');
    expect(html).toContain('data-align="left"');
    expect(html).toContain('style="width:300px"');
  });

  it("omits align/width when they are unset", () => {
    const html = renderNodes([{ type: "image", attrs: { src: "/x.png", alt: "" } }]);
    expect(html).toBe('<img src="/x.png" alt="" />');
  });

  it("drops an image with no src", () => {
    const html = renderNodes([{ type: "image", attrs: { alt: "x" } }]);
    expect(html).toBe("");
  });
});

describe("renderNodes — file block", () => {
  it("renders a file as a download link with the file name", () => {
    const html = renderNodes([
      { type: "file", attrs: { url: "/api/upload/raw?key=doc-images/x.pdf", name: "report.pdf", caption: "" } },
    ]);
    expect(html).toContain("<a ");
    expect(html).toContain('href="/api/upload/raw?key=doc-images/x.pdf"');
    expect(html).toContain("report.pdf");
    expect(html).toContain('download="report.pdf"');
  });

  it("uses caption as link label when provided", () => {
    const html = renderNodes([
      { type: "file", attrs: { url: "/api/upload/raw?key=doc-images/x.pdf", name: "x.pdf", caption: "Q3 Report" } },
    ]);
    expect(html).toContain("Q3 Report");
    expect(html).not.toContain(">x.pdf<");
  });

  it("drops a file with no url", () => {
    const html = renderNodes([{ type: "file", attrs: { name: "x.pdf", url: "" } }]);
    expect(html).toBe("");
  });
});

describe("renderNodes — video block", () => {
  it("renders a video element with controls", () => {
    const html = renderNodes([
      { type: "video", attrs: { url: "/api/upload/raw?key=doc-images/v.mp4", caption: "Demo" } },
    ]);
    expect(html).toContain("<video ");
    expect(html).toContain('src="/api/upload/raw?key=doc-images/v.mp4"');
    expect(html).toContain("controls");
    expect(html).toContain("Demo");
  });

  it("drops a video with no url", () => {
    const html = renderNodes([{ type: "video", attrs: { url: "" } }]);
    expect(html).toBe("");
  });
});

describe("renderBlocksToPdf — file and video blocks", () => {
  const base = { backgroundColor: "default", textColor: "default", textAlignment: "left" };

  it("renders a file block as a labelled link without throwing", async () => {
    const blocks: DocBlock[] = [
      {
        id: "f1",
        type: "file",
        props: { ...base, name: "report.pdf", url: "/api/upload/raw?key=doc-images/r.pdf", caption: "" },
        content: undefined,
        children: [],
      },
    ];
    const buf = await renderBlocksToPdf("Test", blocks);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(0);
  });

  it("renders a video block as italic placeholder without throwing", async () => {
    const blocks: DocBlock[] = [
      {
        id: "v1",
        type: "video",
        props: { ...base, name: "demo.mp4", url: "/api/upload/raw?key=doc-images/d.mp4", caption: "Demo" },
        content: undefined,
        children: [],
      },
    ];
    const buf = await renderBlocksToPdf("Test", blocks);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(0);
  });
});
