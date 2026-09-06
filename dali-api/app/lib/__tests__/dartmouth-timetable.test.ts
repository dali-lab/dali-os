import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCourses } from "../dartmouth-timetable.server";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures/timetable-term-catalog.html"), "utf8");

describe("parseCourses", () => {
  const courses = parseCourses(fixture);
  const byCrn = new Map(courses.map((c) => [c.crn, c]));

  it("parses every row in the data-table", () => {
    expect(courses).toHaveLength(3);
  });

  it("extracts a known scheduled section with all fields", () => {
    const cosc = byCrn.get("91932")!;
    expect(cosc).toMatchObject({
      term: "202609",
      subject: "COSC",
      number: "52", // zero-padding stripped
      section: "01",
      title: "Full-Stack Web Development", // prefers <a> link text
      periodCode: "2",
      periodText: "MWF 2:10-3:15, Th 1:20-2:10",
      room: "008",
      building: "Engineering & CS Center", // &amp; decoded
      instructor: "Tim Tregubov",
      distributive: "TAS",
      enrollLimit: 20,
      enrollCurrent: 20,
    });
  });

  it("keeps the raw period code for unscheduled (ARR) sections", () => {
    const arr = byCrn.get("90042")!;
    expect(arr.number).toBe("89");
    expect(arr.periodCode).toBe("ARR");
    expect(arr.room).toBe(""); // bare &nbsp collapses to empty
    expect(arr.building).toBe("");
  });

  it("reads the cross-list column and a second scheduled section", () => {
    const engl = byCrn.get("90311")!;
    expect(engl.number).toBe("1");
    expect(engl.periodCode).toBe("12");
    expect(engl.crosslist).toBe("WGSS 010");
    expect(engl.building).toBe("Sanborn House");
  });

  it("strips nested <html><head><script> tooltip blocks without corrupting rows", () => {
    // Every row carries a nested-wrapper cell; if the cleaning failed, the row
    // boundary (6-digit term code) or the column offsets would drift.
    expect(courses.every((c) => c.term === "202609")).toBe(true);
    expect(courses.map((c) => c.subject)).toEqual(["COSC", "AAAS", "ENGL"]);
  });

  it("returns [] for empty or non-timetable input", () => {
    expect(parseCourses("")).toEqual([]);
    expect(parseCourses("<html><body>no table here</body></html>")).toEqual([]);
  });
});
