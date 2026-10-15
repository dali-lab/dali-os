import { describe, expect, it } from "vitest";
import { hexColor, visibleTagDots, type DriveItemTag } from "~/lib/drive-tags";

const tags = (n: number): DriveItemTag[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, label: `Tag ${i}`, color: "#abc" }));

describe("visibleTagDots", () => {
  it("shows nothing for no tags or undefined", () => {
    expect(visibleTagDots(undefined)).toEqual({ shown: [], overflow: 0 });
    expect(visibleTagDots([])).toEqual({ shown: [], overflow: 0 });
  });

  it.each([1, 2, 3])("shows all %i tags with no overflow", (n) => {
    expect(visibleTagDots(tags(n))).toEqual({ shown: tags(n), overflow: 0 });
  });

  it("shows the first three in order and counts the rest", () => {
    const all = tags(5);
    expect(visibleTagDots(all)).toEqual({ shown: all.slice(0, 3), overflow: 2 });
  });

  it("overflows by one at four tags", () => {
    expect(visibleTagDots(tags(4)).overflow).toBe(1);
  });

  it("does not mutate its input", () => {
    const all = tags(5);
    visibleTagDots(all);
    expect(all).toHaveLength(5);
  });
});

describe("hexColor", () => {
  it.each(["#fff", "#FFAA00", "#a1b2c3"])("accepts %s", (c) => expect(hexColor(c)).toBe(c));
  it.each([null, undefined, "", "red", "bg-red-500", "#ff", "#ggg", "#ff00ff00", "url(x)"])(
    "rejects %s",
    (c) => expect(hexColor(c)).toBeUndefined(),
  );
});
