import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted so the mock fn exists before vi.mock's factory runs; spread the real
// module so every other s3 export stays intact and only getObjectBytes is faked.
const { getObjectBytes } = vi.hoisted(() => ({ getObjectBytes: vi.fn() }));
vi.mock("~/lib/s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/s3")>()),
  getObjectBytes,
}));

import { documentToPrintHtml, inlineUploadImages } from "~/lib/pdf/print-html.server";

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

describe("inlineUploadImages", () => {
  beforeEach(() => getObjectBytes.mockReset());

  it("replaces an authed upload src with a data: URI fetched from S3", async () => {
    getObjectBytes.mockResolvedValue({
      body: Buffer.from("JPEGDATA"),
      contentType: "image/jpeg",
    });
    const src = "/api/upload/raw?key=uploads%2Fdoc-images%2Fabc-dali-header.jpg";
    const out = await inlineUploadImages(`<img src="${src}" alt="header" />`);

    // Decoded the key before fetching, and emitted a base64 data URI.
    expect(getObjectBytes).toHaveBeenCalledWith("uploads/doc-images/abc-dali-header.jpg");
    expect(out).toContain(`src="data:image/jpeg;base64,${Buffer.from("JPEGDATA").toString("base64")}"`);
    expect(out).not.toContain("/api/upload/raw");
    expect(out).toContain('alt="header"');
  });

  it("handles an absolute upload URL without mangling the origin", async () => {
    getObjectBytes.mockResolvedValue({ body: Buffer.from("X"), contentType: "image/png" });
    const out = await inlineUploadImages(
      `<img src="https://dali.dartmouth.edu/api/upload/raw?key=uploads%2Fa.png" />`,
    );
    expect(out).toContain("src=\"data:image/png;base64,");
    expect(out).not.toContain("dali.dartmouth.edu");
  });

  it("leaves the src untouched when the object can't be read (best-effort)", async () => {
    getObjectBytes.mockRejectedValue(new Error("no such key"));
    const src = "/api/upload/raw?key=uploads%2Fgone.jpg";
    const out = await inlineUploadImages(`<img src="${src}" />`);
    expect(out).toContain(src);
  });

  it("ignores non-upload image srcs and never calls S3", async () => {
    const html = `<img src="https://example.com/logo.png" />`;
    const out = await inlineUploadImages(html);
    expect(out).toBe(html);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });
});
