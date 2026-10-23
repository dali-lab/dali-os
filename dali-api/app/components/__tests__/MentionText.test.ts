import { describe, expect, it } from "vitest";
import { splitMentions } from "../MentionText";

describe("splitMentions", () => {
  it("sets off handles between text runs", () => {
    expect(splitMentions("nice one @maya_c and @Leo!")).toEqual([
      { text: "nice one " },
      { text: "@maya_c", handle: "maya_c" },
      { text: " and " },
      { text: "@Leo", handle: "leo" },
      { text: "!" },
    ]);
  });

  it("reads a handle at the very start", () => {
    expect(splitMentions("@sam look")).toEqual([
      { text: "@sam", handle: "sam" },
      { text: " look" },
    ]);
  });

  it("leaves email addresses and a bare @ alone", () => {
    expect(splitMentions("mail a@b.edu or @ me")).toEqual([{ text: "mail a@b.edu or @ me" }]);
  });

  it("keeps line breaks in the text runs", () => {
    expect(splitMentions("hi\n@jo")).toEqual([{ text: "hi\n" }, { text: "@jo", handle: "jo" }]);
  });

  it("returns nothing for empty text", () => {
    expect(splitMentions("")).toEqual([]);
  });
});
