import { describe, expect, it } from "vitest";
import { isFetchableUrl, parseLinkPreview } from "../link-preview.server";

describe("isFetchableUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(isFetchableUrl("https://example.com/a")?.hostname).toBe("example.com");
    expect(isFetchableUrl("http://example.com")).not.toBeNull();
  });
  it("refuses other schemes, credentials and internal hosts", () => {
    for (const u of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "ftp://example.com",
      "https://user:pw@example.com",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://localhost/",
      "http://db.internal/",
      "http://thing.flycast/",
      "not a url",
    ]) {
      expect(isFetchableUrl(u), u).toBeNull();
    }
  });
});

describe("parseLinkPreview", () => {
  const page = "https://example.com/post/1";
  it("reads the Open Graph image, title and description", () => {
    const html = `<head><title>Fallback</title><meta property="og:image" content="https://cdn.example.com/a.png?x=1&amp;y=2"><meta property="og:title" content="Hello &amp; welcome"><meta name="description" content="A page"></head>`;
    expect(parseLinkPreview(html, page)).toEqual({ image: "https://cdn.example.com/a.png?x=1&y=2", title: "Hello & welcome", description: "A page" });
  });
  it("resolves relative images and falls back to twitter and <title>", () => {
    const html = `<title>Plain</title><meta content="/img/card.jpg" name="twitter:image">`;
    expect(parseLinkPreview(html, page)).toEqual({ image: "https://example.com/img/card.jpg", title: "Plain", description: null });
  });
  it("decodes &amp; last so escaped entities stay literal", () => {
    const html = `<meta property="og:title" content="Use &amp;lt;b&amp;gt; for bold">`;
    expect(parseLinkPreview(html, page).title).toBe("Use &lt;b&gt; for bold");
  });
  it("drops non-https images", () => {
    expect(parseLinkPreview(`<meta property="og:image" content="http://example.com/a.png">`, page).image).toBeNull();
    expect(parseLinkPreview(`<meta property="og:image" content="javascript:alert(1)">`, page).image).toBeNull();
  });
  it("is empty when nothing is advertised", () => {
    expect(parseLinkPreview("<p>hi</p>", page)).toEqual({ image: null, title: null, description: null });
  });
});
