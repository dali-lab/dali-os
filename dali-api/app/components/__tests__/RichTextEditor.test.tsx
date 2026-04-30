import { describe, it, expect } from "vitest";
import { isSafeLinkUrl } from "../RichTextEditor";

describe("isSafeLinkUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isSafeLinkUrl("http://example.com")).toBe(true);
    expect(isSafeLinkUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("accepts mailto URLs", () => {
    expect(isSafeLinkUrl("mailto:hello@example.com")).toBe(true);
  });

  it("rejects javascript URLs", () => {
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("JavaScript:alert(1)")).toBe(false);
  });

  it("rejects data URLs and other unsupported schemes", () => {
    expect(isSafeLinkUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeLinkUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeLinkUrl("ftp://example.com")).toBe(false);
  });

  it("rejects empty and non-URL strings", () => {
    expect(isSafeLinkUrl("")).toBe(false);
    expect(isSafeLinkUrl("   ")).toBe(false);
    expect(isSafeLinkUrl("not a url")).toBe(false);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isSafeLinkUrl("  https://example.com  ")).toBe(true);
  });
});
