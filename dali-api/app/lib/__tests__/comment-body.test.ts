import { describe, expect, it } from "vitest";
import { keepMentionChips, mentionHandleMap, parseBodySegments } from "../comment-body";

const chip = { type: "mention" as const, userId: "u3", label: "Ada" };

describe("editing a comment with mention chips", () => {
  it("loses the chip when only the typed text is parsed (the bug)", () => {
    expect(parseBodySegments("hi @Ada", new Map())).toEqual([{ type: "text", text: "hi " }, { type: "text", text: "@Ada" }]);
  });
  it("keeps a chip already on the comment, matched without regard to case", () => {
    expect(keepMentionChips("hello @ada!", [chip])).toEqual([{ type: "text", text: "hello " }, { type: "mention", userId: "u3", label: "ada" }, { type: "text", text: "!" }]);
  });
  it("drops a chip whose handle was deleted from the text", () => {
    expect(keepMentionChips("hello", [chip])).toEqual([{ type: "text", text: "hello" }]);
  });
  it("lets newly picked mentions sit next to the existing ones", () => {
    const map = mentionHandleMap([chip], new Map([["leo", "u4"]]));
    expect(parseBodySegments("@Ada @leo", map).filter((s) => s.type === "mention")).toMatchObject([{ userId: "u3" }, { userId: "u4" }]);
  });
});
