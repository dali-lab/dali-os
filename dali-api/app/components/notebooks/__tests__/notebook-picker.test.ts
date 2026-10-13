import { describe, it, expect } from "vitest";
import { notebookQueryString, notebookStats } from "~/components/notebooks/notebook-picker";

describe("notebookQueryString", () => {
  it("is empty with nothing to narrow by", () => {
    expect(notebookQueryString("", {})).toBe("");
    expect(notebookQueryString("   ", { projectId: null, meetingId: null })).toBe("");
  });

  it("carries the trimmed search, the project and the meeting", () => {
    const params = new URLSearchParams(notebookQueryString(" week ", { projectId: "p1", meetingId: "m1" }));
    expect(params.get("q")).toBe("week");
    expect(params.get("projectId")).toBe("p1");
    expect(params.get("meetingId")).toBe("m1");
  });

  it("escapes what it carries", () => {
    expect(notebookQueryString("a&b", {})).toBe("q=a%26b");
  });
});

describe("notebookStats", () => {
  it("counts notes and names the last date", () => {
    expect(notebookStats({ tabCount: 3, lastNoteAt: "2026-09-10T15:00:00.000Z" })).toBe("3 notes · last Sep 10, 2026");
  });

  it("says note in the singular", () => {
    expect(notebookStats({ tabCount: 1, lastNoteAt: "2026-09-10T15:00:00.000Z" })).toBe("1 note · last Sep 10, 2026");
  });

  it("leaves the date off a notebook with no dated note", () => {
    expect(notebookStats({ tabCount: 0, lastNoteAt: null })).toBe("0 notes");
  });
});
