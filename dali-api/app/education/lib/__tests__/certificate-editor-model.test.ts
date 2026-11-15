import { describe, expect, it } from "vitest";
import {
  applyPlacements,
  fieldsToSlide,
  newField,
  nudgeFields,
  pushHistory,
  redoHistory,
  startHistory,
  undoHistory,
} from "../certificate-editor-model";
import { LINE_HEIGHT, type PlacedField } from "../certificate-fields";

const f = (over: Partial<PlacedField> = {}): PlacedField => ({ key: "studentName", x: 0.1, y: 0.2, w: 0.5, fontSize: 50, color: "#000000", align: "left", bold: false, fit: "wrap", ...over });

describe("newField", () => {
  it("is a centred box, and the student name shrinks while the rest wrap", () => {
    expect(newField("studentName", 1000)).toMatchObject({ x: 0.15, w: 0.7, fontSize: 50, fit: "shrink", align: "center", bold: true });
    expect(newField("offeringTitle", 1000).fit).toBe("wrap");
  });
});

describe("fieldsToSlide", () => {
  it("maps fields to free text elements in stage units with the key as id", () => {
    const slide = fieldsToSlide([f()], 1000, 800);
    expect(slide.elements[0]).toMatchObject({ id: "studentName", kind: "text", slot: null, x: 100, y: 160, w: 500, h: 50 * LINE_HEIGHT });
  });

  it("uses a measured height and a live placement when given", () => {
    const slide = fieldsToSlide([f()], 1000, 800, { studentName: 120 }, new Map([["studentName", { x: 1, y: 2, w: 3, h: 4, rot: 0 }]]));
    expect(slide.elements[0]).toMatchObject({ x: 1, y: 2, w: 3, h: 4 });
    expect(fieldsToSlide([f()], 1000, 800, { studentName: 120 }).elements[0].h).toBe(120);
  });

  it("opens a legacy field as a box", () => {
    const slide = fieldsToSlide([f({ w: undefined, fit: undefined, align: "left", x: 0.2 })], 1000, 800);
    expect(slide.elements[0].w).toBeCloseTo(700);
  });
});

describe("applyPlacements", () => {
  it("writes fractions of the page", () => {
    const [out] = applyPlacements([f()], { studentName: { x: 250, y: 400, w: 500, h: 58, rot: 0 } }, 1000, 800);
    expect(out).toMatchObject({ x: 0.25, y: 0.5, w: 0.5 });
  });

  it("keeps the box on the page", () => {
    const [out] = applyPlacements([f()], { studentName: { x: 900, y: -50, w: 500, h: 58, rot: 0 } }, 1000, 800);
    expect(out.y).toBe(0);
    expect(out.x! + out.w!).toBeLessThanOrEqual(1);
  });

  it("leaves other fields alone", () => {
    const other = f({ key: "issuedDate" });
    const out = applyPlacements([f(), other], { studentName: { x: 0, y: 0, w: 500, h: 58, rot: 0 } }, 1000, 800);
    expect(out[1]).toBe(other);
  });
});

describe("nudgeFields", () => {
  it("moves the chosen fields by page units", () => {
    const [a, b] = nudgeFields([f(), f({ key: "issuedDate" })], ["studentName"], 10, -5, 1000, 800);
    expect(a.x).toBeCloseTo(0.11);
    expect(a.y).toBeCloseTo(0.19375);
    expect(b.x).toBe(0.1);
  });
});

describe("history", () => {
  it("undoes and redoes, and a new edit clears redo", () => {
    const a = [f()];
    const b = [f({ x: 0.2 })];
    const c = [f({ x: 0.3 })];
    let h = pushHistory(startHistory(a), b);
    h = pushHistory(h, c);
    h = undoHistory(h);
    expect(h.present).toBe(b);
    h = redoHistory(h);
    expect(h.present).toBe(c);
    h = undoHistory(undoHistory(h));
    expect(h.present).toBe(a);
    expect(undoHistory(h)).toBe(h);
    h = pushHistory(h, [f({ x: 0.9 })]);
    expect(h.future).toEqual([]);
    expect(redoHistory(h)).toBe(h);
  });

  it("ignores a push of the same array", () => {
    const h = startHistory([f()]);
    expect(pushHistory(h, h.present)).toBe(h);
  });
});
