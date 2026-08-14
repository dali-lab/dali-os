import { describe, it, expect } from "vitest";
import { isPrefetchRequest } from "~/lib/prefetch";

const req = (headers: Record<string, string>) =>
  new Request("https://os.dali.dartmouth.edu/projects/abc", { headers });

describe("isPrefetchRequest", () => {
  it("treats an ordinary navigation as a real visit", () => {
    expect(isPrefetchRequest(req({}))).toBe(false);
    expect(isPrefetchRequest(req({ "sec-fetch-dest": "document" }))).toBe(false);
  });

  it("detects the Chromium prefetch headers", () => {
    expect(isPrefetchRequest(req({ "sec-purpose": "prefetch" }))).toBe(true);
    // Sec-Purpose is a token list — prerendering carries the prefetch token too.
    expect(isPrefetchRequest(req({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isPrefetchRequest(req({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetchRequest(req({ purpose: "Prefetch" }))).toBe(true);
  });

  it("detects the Firefox prefetch header", () => {
    expect(isPrefetchRequest(req({ "x-moz": "prefetch" }))).toBe(true);
  });

  it("ignores unrelated values of the same headers", () => {
    expect(isPrefetchRequest(req({ purpose: "subresource" }))).toBe(false);
    expect(isPrefetchRequest(req({ "x-moz": "viewsource" }))).toBe(false);
  });
});
