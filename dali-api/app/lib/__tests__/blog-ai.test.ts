import { describe, expect, it } from "vitest";
import { aiPassages, type AiBlock } from "../blog-ai";

const text = (id: string, value: string, type = "paragraph"): AiBlock => ({
  id,
  type,
  content: value ? [{ type: "text", text: value }] : [],
  children: [],
});

describe("aiPassages", () => {
  it("leaves out anything Markdown would not bring back", () => {
    const blocks: AiBlock[] = [
      text("a", "Intro"),
      { id: "img", type: "image", children: [] },
      text("b", "After the picture", "heading"),
      {
        id: "m",
        type: "paragraph",
        content: [{ type: "text", text: "Thanks " }, { type: "mention" }],
        children: [],
      },
      { id: "l", type: "bulletListItem", content: [{ type: "text", text: "One" }], children: [text("c", "Nested")] },
    ];
    expect(aiPassages(blocks)).toEqual([["a"], ["b"], ["l"]]);
  });

  it("splits a long post into passages under the limit", () => {
    const blocks = [text("a", "x".repeat(60)), text("b", "y".repeat(60)), text("c", "z".repeat(30))];
    expect(aiPassages(blocks, 100)).toEqual([["a"], ["b", "c"]]);
  });

  it("drops blank lines at the edges of a passage and skips an empty post", () => {
    expect(aiPassages([text("e1", ""), text("a", "Hi"), text("e2", ""), text("b", "Bye"), text("e3", "")])).toEqual([
      ["a", "e2", "b"],
    ]);
    expect(aiPassages([text("e1", "")])).toEqual([]);
  });
});
