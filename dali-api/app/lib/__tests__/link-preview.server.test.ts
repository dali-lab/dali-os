import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("node:https", () => ({ default: { get: hoisted.get } }));

import { fetchLinkPreview, isFetchableUrl, parseLinkPreview } from "../link-preview.server";

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

describe("fetchLinkPreview deadline", () => {
  afterEach(() => vi.useRealTimers());

  it("gives up on a server that never answers, across redirect hops", async () => {
    vi.useFakeTimers();
    const destroyed: boolean[] = [];
    hoisted.get.mockImplementation((_url: URL, _opts: unknown, cb: (res: unknown) => void) => {
      const req = Object.assign(new EventEmitter(), { destroy: () => destroyed.push(true) });
      if (hoisted.get.mock.calls.length === 1) {
        const res = Object.assign(new EventEmitter(), { statusCode: 302, headers: { location: "https://example.org/b" }, resume: () => {} });
        setTimeout(() => cb(res), 5000);
      }
      return req;
    });
    const result = fetchLinkPreview("https://example.com/a");
    await vi.advanceTimersByTimeAsync(5000);
    expect(hoisted.get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await result).toBeNull();
    expect(destroyed.length).toBeGreaterThan(0);
  });

  it("refuses a redirect to a private host without requesting it", async () => {
    hoisted.get.mockReset();
    hoisted.get.mockImplementation((_url: URL, _opts: unknown, cb: (res: unknown) => void) => {
      const req = Object.assign(new EventEmitter(), { destroy: () => {} });
      const res = Object.assign(new EventEmitter(), { statusCode: 302, headers: { location: "http://169.254.169.254/latest" }, resume: () => {} });
      queueMicrotask(() => cb(res));
      return req;
    });
    expect(await fetchLinkPreview("https://example.com/a")).toBeNull();
    expect(hoisted.get).toHaveBeenCalledTimes(1);
  });

  it("returns null for a malformed Location header instead of throwing", async () => {
    hoisted.get.mockImplementation((_url: URL, _opts: unknown, cb: (res: unknown) => void) => {
      const req = Object.assign(new EventEmitter(), { destroy: () => {} });
      const res = Object.assign(new EventEmitter(), { statusCode: 302, headers: { location: "http://[" }, resume: () => {} });
      queueMicrotask(() => cb(res));
      return req;
    });
    expect(await fetchLinkPreview("https://example.com/a")).toBeNull();
  });
});
