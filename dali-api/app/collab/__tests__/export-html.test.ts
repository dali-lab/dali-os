import { describe, it, expect } from "vitest";
import { renderNodes } from "../export-html";

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
