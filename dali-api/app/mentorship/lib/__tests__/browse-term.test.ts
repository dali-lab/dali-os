import { describe, expect, it } from "vitest";
import { browseTermId } from "../browse-term";

const term = (search: string, current: string | null = "t-cur") =>
  browseTermId(new URLSearchParams(search), current);

describe("browseTermId", () => {
  it("opens on the current term when the URL names none", () => {
    expect(term("")).toBe("t-cur");
    expect(term("q=ada")).toBe("t-cur");
  });

  it("is any term when there is no current term and none in the URL", () => {
    expect(term("", null)).toBe("");
  });

  it("uses ?term=<id>", () => {
    expect(term("term=t-26s")).toBe("t-26s");
  });

  it("reads ?term=all as any term", () => {
    expect(term("term=all")).toBe("");
  });

  it("still reads the old ?termId= links", () => {
    expect(term("termId=t-26s")).toBe("t-26s");
    expect(term("termId=")).toBe("");
  });

  it("prefers ?term= over a leftover ?termId=", () => {
    expect(term("termId=t-old&term=t-26s")).toBe("t-26s");
    expect(term("termId=t-old&term=all")).toBe("");
  });
});
