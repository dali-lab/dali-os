import { describe, expect, it } from "vitest";
import {
  backgroundIssue,
  fieldBox,
  LINE_HEIGHT,
  parsePlacedFields,
  shrinkFontSize,
  upgradeLegacyField,
  type PlacedField,
} from "../certificate-fields";

const base = { key: "studentName", x: 0.5, y: 0.4, fontSize: 40, color: "#112233", align: "center", bold: true };

describe("parsePlacedFields", () => {
  it("leaves a legacy anchor field without w or fit", () => {
    expect(parsePlacedFields([base])).toEqual([base]);
  });

  it("keeps a box field's width and fit", () => {
    const [f] = parsePlacedFields([{ ...base, x: 0.1, w: 0.5, fit: "shrink" }]);
    expect(f).toMatchObject({ x: 0.1, w: 0.5, fit: "shrink" });
  });

  it("defaults fit to wrap, including for the student name", () => {
    expect(parsePlacedFields([{ ...base, w: 0.5 }])[0].fit).toBe("wrap");
    expect(parsePlacedFields([{ ...base, w: 0.5, fit: "nope" }])[0].fit).toBe("wrap");
  });

  it("drops a width that is not positive and treats the field as legacy", () => {
    for (const w of [0, -1, "x", Number.NaN]) {
      const [f] = parsePlacedFields([{ ...base, w }]);
      expect(f.w).toBeUndefined();
      expect(f.fit).toBeUndefined();
    }
  });

  it("clamps a box so x + w stays within the page", () => {
    const [a] = parsePlacedFields([{ ...base, x: 0.8, w: 0.5 }]);
    expect(a.x + a.w!).toBeCloseTo(1);
    const [b] = parsePlacedFields([{ ...base, x: 0.5, w: 4 }]);
    expect(b.w).toBe(0.5);
    const [c] = parsePlacedFields([{ ...base, x: 1.4, w: 0.5 }]);
    expect(c.x + c.w!).toBeLessThanOrEqual(1);
    expect(c.w).toBeGreaterThan(0);
  });

  it("keeps the first of a repeated key", () => {
    const out = parsePlacedFields([{ ...base, x: 0.1 }, { ...base, x: 0.9 }, { ...base, key: "issuedDate" }]);
    expect(out.map((f) => [f.key, f.x])).toEqual([["studentName", 0.1], ["issuedDate", 0.5]]);
  });

  it("drops unknown keys and non-objects", () => {
    expect(parsePlacedFields([null, 3, { ...base, key: "bogus" }])).toEqual([]);
    expect(parsePlacedFields("nope")).toEqual([]);
  });
});

describe("upgradeLegacyField", () => {
  const legacy = (over: Partial<PlacedField>): PlacedField => ({ ...(base as PlacedField), ...over });

  it("centres a 0.7 wide box on a centre anchor", () => {
    const f = upgradeLegacyField(legacy({ align: "center", x: 0.5 }));
    expect(f.w).toBeCloseTo(0.7);
    expect(f.x).toBeCloseTo(0.15);
    expect(f.fit).toBe("shrink");
  });

  it("gives an upgraded course title the wrap default", () => {
    expect(upgradeLegacyField(legacy({ key: "offeringTitle" })).fit).toBe("wrap");
  });

  it("runs a left anchor rightward from the anchor", () => {
    const f = upgradeLegacyField(legacy({ align: "left", x: 0.2 }));
    expect(f.x).toBeCloseTo(0.2);
    expect(f.w).toBeCloseTo(0.7);
  });

  it("runs a right anchor leftward from the anchor", () => {
    const f = upgradeLegacyField(legacy({ align: "right", x: 0.9 }));
    expect(f.x + f.w!).toBeCloseTo(0.9);
    expect(f.w).toBeCloseTo(0.7);
  });

  it("narrows the width near an edge instead of moving the anchor", () => {
    const center = upgradeLegacyField(legacy({ align: "center", x: 0.1 }));
    expect(center.w).toBeCloseTo(0.2);
    expect(center.x + center.w! / 2).toBeCloseTo(0.1);
    const left = upgradeLegacyField(legacy({ align: "left", x: 0.8 }));
    expect(left.x).toBeCloseTo(0.8);
    expect(left.w).toBeCloseTo(0.2);
    const right = upgradeLegacyField(legacy({ align: "right", x: 0.15 }));
    expect(right.x + right.w!).toBeCloseTo(0.15);
    expect(right.w).toBeCloseTo(0.15);
  });

  it("keeps a minimum width at the very edge and stays on the page", () => {
    const f = upgradeLegacyField(legacy({ align: "center", x: 0 }));
    expect(f.w).toBeGreaterThan(0);
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.x + f.w!).toBeLessThanOrEqual(1);
  });

  it("leaves a box field as it is", () => {
    const box = legacy({ x: 0.1, w: 0.3, fit: "shrink" });
    expect(upgradeLegacyField(box)).toEqual(box);
  });
});

describe("fieldBox", () => {
  it("is in page units with one line of height", () => {
    const f = legacy2({ x: 0.1, y: 0.25, w: 0.5, fontSize: 50 });
    expect(fieldBox(f, 1000, 800)).toEqual({ x: 100, y: 200, w: 500, h: 50 * LINE_HEIGHT });
  });

  it("converts a legacy field first", () => {
    const box = fieldBox({ ...(base as PlacedField), align: "left", x: 0.2 }, 1000, 800);
    expect(box.x).toBeCloseTo(200);
    expect(box.w).toBeCloseTo(700);
  });
});

function legacy2(over: Partial<PlacedField>): PlacedField {
  return { ...(base as PlacedField), ...over };
}

describe("shrinkFontSize", () => {
  it("leaves text that fits alone", () => {
    expect(shrinkFontSize(40, 500, 400)).toBe(40);
  });

  it("scales to the box width", () => {
    expect(shrinkFontSize(40, 500, 1000)).toBe(20);
  });

  it("stops at 40 percent of the set size", () => {
    expect(shrinkFontSize(40, 100, 1000)).toBe(16);
  });
});

describe("backgroundIssue", () => {
  it.each([
    ["image/png", "uploads/a.png"],
    ["image/jpeg", "uploads/a.jpg"],
    ["image/jpg", "uploads/a.jpg"],
    ["IMAGE/PNG; charset=binary", "uploads/a"],
    [null, "uploads/a.png"],
    [null, "uploads/a.JPEG"],
  ])("accepts %s %s", (type, key) => {
    expect(backgroundIssue(type, key)).toBeNull();
  });

  it("flags a PDF by type or, with no type, by extension", () => {
    expect(backgroundIssue("application/pdf", "uploads/a.png")).toBe("pdf");
    expect(backgroundIssue(null, "uploads/Certificate_2.pdf")).toBe("pdf");
  });

  it("flags other formats as unsupported", () => {
    expect(backgroundIssue("image/webp", "uploads/a.webp")).toBe("unsupported");
    expect(backgroundIssue("image/svg+xml", "uploads/a.svg")).toBe("unsupported");
    expect(backgroundIssue(null, "uploads/a")).toBe("unsupported");
  });
});
