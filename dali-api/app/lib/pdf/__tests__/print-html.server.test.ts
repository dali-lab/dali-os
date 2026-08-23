import { describe, it, expect } from "vitest";
import { documentToPrintHtml } from "~/lib/pdf/print-html.server";

const para = (text: string) => ({
  id: "p1",
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

describe("documentToPrintHtml", () => {
  it("wraps the document in a full HTML page with the title + content + print CSS", async () => {
    const html = await documentToPrintHtml("My Agreement", [para("Hello world")] as never);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("My Agreement");
    expect(html).toContain("Hello world");
    expect(html).toMatch(/@page/); // the print stylesheet is inlined
  });

  it("escapes the title", async () => {
    const html = await documentToPrintHtml("<b>x</b>", []);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
