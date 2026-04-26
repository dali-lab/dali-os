import { describe, it, expect } from "vitest";
import { interpolate, bodyToHtml } from "~/lib/email";

describe("interpolate", () => {
  it("replaces every {{firstName}} occurrence", () => {
    expect(interpolate("Hi {{firstName}}, welcome {{firstName}}!", "Ada")).toBe(
      "Hi Ada, welcome Ada!",
    );
  });

  it("returns the input unchanged when there are no placeholders", () => {
    expect(interpolate("plain text", "Ada")).toBe("plain text");
  });

  it("does not interpret regex characters in the firstName as a pattern", () => {
    expect(interpolate("Hi {{firstName}}", "$&")).toBe("Hi $&");
  });
});

describe("bodyToHtml", () => {
  it("wraps double-newline-separated paragraphs in <p> tags", () => {
    expect(bodyToHtml("para 1\n\npara 2")).toBe("<p>para 1</p>\n<p>para 2</p>");
  });

  it("converts single newlines inside a paragraph to <br/>", () => {
    expect(bodyToHtml("line 1\nline 2")).toBe("<p>line 1<br/>line 2</p>");
  });

  it("handles a single paragraph with no newlines", () => {
    expect(bodyToHtml("hello")).toBe("<p>hello</p>");
  });

  it("preserves empty paragraphs as empty <p> tags", () => {
    expect(bodyToHtml("a\n\n\n\nb")).toBe("<p>a</p>\n<p></p>\n<p>b</p>");
  });
});
