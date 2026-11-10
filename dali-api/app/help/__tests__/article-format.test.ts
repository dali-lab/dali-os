import { describe, expect, it } from "vitest";
import { HelpArticleFormatError, parseHelpArticle } from "../article-format";

const article = (header: string, body = "Body text.") => `---\n${header}\n---\n\n${body}\n`;

describe("parseHelpArticle", () => {
  it("reads the header and body", () => {
    const a = parseHelpArticle(
      "rooms",
      article(
        [
          "title: Booking rooms",
          'summary: "Find a room: book it, change it."',
          "audience: [core, mentor]",
          "flag: ask-dali",
          "paths: [/rooms, /rooms/:id]",
          "keywords: [room, 'reserve']",
        ].join("\n"),
        "## Book a room\n\nPick a time.",
      ),
    );
    expect(a).toEqual({
      slug: "rooms",
      title: "Booking rooms",
      summary: "Find a room: book it, change it.",
      audience: ["core", "mentor"],
      flag: "ask-dali",
      paths: ["/rooms", "/rooms/:id"],
      keywords: ["room", "reserve"],
      url: "/help/articles/rooms",
      body: "## Book a room\n\nPick a time.",
    });
  });

  it("defaults to every lab member, no flag and no paths", () => {
    expect(parseHelpArticle("a", article("title: A\nsummary: B"))).toMatchObject({
      audience: [],
      flag: null,
      paths: [],
      keywords: [],
    });
  });

  it("accepts a single value without brackets and Windows line endings", () => {
    const a = parseHelpArticle("a", "---\r\ntitle: A\r\nsummary: B\r\naudience: core\r\n---\r\nHi");
    expect(a.audience).toEqual(["core"]);
    expect(a.body).toBe("Hi");
  });

  it.each([
    ["no header", "Just text", /missing the --- header/],
    ["no title", article("summary: B"), /needs a title/],
    ["no summary", article("title: A"), /needs a summary/],
    ["an unknown field", article("title: A\nsummary: B\nowner: x"), /unknown header field "owner"/],
    ["an unknown audience", article("title: A\nsummary: B\naudience: [core, mentors]"), /unknown audience "mentors"/],
    ["a line without a colon", article("title: A\nsummary: B\noops"), /can't read header line/],
  ])("rejects %s", (_label, raw, message) => {
    expect(() => parseHelpArticle("a", raw)).toThrow(HelpArticleFormatError);
    expect(() => parseHelpArticle("a", raw)).toThrow(message);
  });
});
