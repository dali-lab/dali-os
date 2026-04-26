import { describe, it, expect } from "vitest";
import { interpolate, bodyToHtml } from "~/lib/email";

describe("interpolate", () => {
  it("replaces every {{firstName}} occurrence", () => {
    expect(interpolate("Hi {{firstName}}, welcome {{firstName}}!", { firstName: "Ada" })).toBe(
      "Hi Ada, welcome Ada!",
    );
  });

  it("replaces {{domain}} when provided", () => {
    expect(
      interpolate("Hi {{firstName}}, you applied to {{domain}}.", {
        firstName: "Ada",
        domain: "Engineering",
      }),
    ).toBe("Hi Ada, you applied to Engineering.");
  });

  it("substitutes {{domain}} with empty string when not provided", () => {
    expect(interpolate("Hi {{firstName}} ({{domain}})", { firstName: "Ada" })).toBe("Hi Ada ()");
  });

  it("returns the input unchanged when there are no placeholders", () => {
    expect(interpolate("plain text", { firstName: "Ada" })).toBe("plain text");
  });

  it("does not interpret regex characters in firstName as a pattern", () => {
    expect(interpolate("Hi {{firstName}}", { firstName: "$&" })).toBe("Hi $&");
  });

  it("does not interpret regex characters in domain as a pattern", () => {
    expect(interpolate("Domain: {{domain}}", { firstName: "x", domain: "$1" })).toBe("Domain: $1");
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
