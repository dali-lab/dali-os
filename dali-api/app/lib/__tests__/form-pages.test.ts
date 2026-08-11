import { describe, it, expect } from "vitest";
import { paginateQuestions, hasPageBreaks } from "../form-pages";
import type { Question } from "~/types";

function q(key: string, type: Question["type"] = "text", data?: Question["data"]): Question {
  return { key, type, required: false, data: data ?? { label: key } };
}
function brk(label = "", description = ""): Question {
  return { key: `pb-${label}`, type: "pageBreak", required: false, data: { label, description } };
}

describe("hasPageBreaks", () => {
  it("is false without a break and true with one", () => {
    expect(hasPageBreaks([q("a"), q("b")])).toBe(false);
    expect(hasPageBreaks([q("a"), brk(), q("b")])).toBe(true);
  });
});

describe("paginateQuestions", () => {
  it("returns a single untitled page when there are no breaks", () => {
    const pages = paginateQuestions([q("a"), q("b")]);
    expect(pages).toHaveLength(1);
    expect(pages[0].title).toBeUndefined();
    expect(pages[0].questions.map((x) => x.key)).toEqual(["a", "b"]);
  });

  it("returns a single empty page for an empty form", () => {
    const pages = paginateQuestions([]);
    expect(pages).toHaveLength(1);
    expect(pages[0].questions).toEqual([]);
  });

  it("splits at each break and drops the marker from questions", () => {
    const pages = paginateQuestions([q("a"), brk(), q("b"), q("c"), brk(), q("d")]);
    expect(pages.map((p) => p.questions.map((x) => x.key))).toEqual([
      ["a"],
      ["b", "c"],
      ["d"],
    ]);
    expect(pages.flatMap((p) => p.questions).some((x) => x.type === "pageBreak")).toBe(false);
  });

  it("maps a break's label/description to the title/subtitle of the page it starts", () => {
    const pages = paginateQuestions([q("a"), brk("Details", "Tell us more"), q("b")]);
    expect(pages[0].title).toBeUndefined();
    expect(pages[1].title).toBe("Details");
    expect(pages[1].subtitle).toBe("Tell us more");
  });

  it("treats blank break label/description as no heading", () => {
    const pages = paginateQuestions([q("a"), brk("  ", "  "), q("b")]);
    expect(pages[1].title).toBeUndefined();
    expect(pages[1].subtitle).toBeUndefined();
  });

  it("yields a titled first page when the form leads with a break", () => {
    const pages = paginateQuestions([brk("Start"), q("a")]);
    expect(pages).toHaveLength(2);
    expect(pages[0].questions).toEqual([]);
    expect(pages[1].title).toBe("Start");
    expect(pages[1].questions.map((x) => x.key)).toEqual(["a"]);
  });
});
