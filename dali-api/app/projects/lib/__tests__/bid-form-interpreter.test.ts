import { describe, it, expect } from "vitest";
import { interpretBidForm } from "../bid-form-interpreter";
import type { ColumnMapping, ColumnMappingEntry } from "../slot-roles";

// Bid mapping helper: list each project column in rank order. A bid is now
// just a project; domain/notes columns are no longer part of the spine.
function mapping(projectKeys: string[]): ColumnMapping {
  const entries: ColumnMappingEntry[] = projectKeys.map((k, i) => ({
    source: "question",
    questionKey: k,
    role: "project",
    label: `P${i + 1}`,
    order: i,
  }));
  return { version: 1, entries };
}

describe("interpretBidForm (mapping-driven)", () => {
  it("interprets a single bid as a projectId", () => {
    const m = mapping(["p1"]);
    const r = interpretBidForm({ p1: "proj_a" }, m);
    expect(r).toEqual({ ok: true, bids: [{ projectId: "proj_a" }] });
  });

  it("ignores a builtin (submitter) entry — it carries no bid answer", () => {
    const m: ColumnMapping = {
      version: 1,
      entries: [
        { source: "builtin", builtin: "submitter", role: "submitter", label: "By", order: 0 },
        { source: "question", questionKey: "p1", role: "project", label: "P1", order: 1 },
      ],
    };
    const r = interpretBidForm({ p1: "proj_a" }, m);
    expect(r).toEqual({ ok: true, bids: [{ projectId: "proj_a" }] });
  });

  it("produces 3 ranked bids from 3 project columns in order", () => {
    const m = mapping(["p1", "p2", "p3"]);
    const r = interpretBidForm(
      { p1: "proj_a", p2: "proj_b", p3: "proj_c" },
      m,
    );
    expect(r).toEqual({
      ok: true,
      bids: [
        { projectId: "proj_a" },
        { projectId: "proj_b" },
        { projectId: "proj_c" },
      ],
    });
  });

  it("skips a ranked choice the member left blank rather than failing", () => {
    const m = mapping(["p1", "p2", "p3"]);
    // Only the 1st and 3rd choice are answered.
    const r = interpretBidForm({ p1: "proj_a", p3: "proj_c" }, m);
    expect(r).toEqual({
      ok: true,
      bids: [{ projectId: "proj_a" }, { projectId: "proj_c" }],
    });
  });

  it("returns no bids (not an error) when nothing was submitted", () => {
    const m = mapping(["p1"]);
    const r = interpretBidForm({}, m);
    expect(r).toEqual({ ok: true, bids: [] });
  });

  it("ignores answers for questions not in the mapping", () => {
    const m = mapping(["p1"]);
    const r = interpretBidForm({ intro: "ignored", p1: "proj_a" }, m);
    expect(r).toEqual({ ok: true, bids: [{ projectId: "proj_a" }] });
  });

  it("ignores legacy mapping entries whose role is no longer recognised", () => {
    // parseColumnMapping strips retired roles on load, but if anything
    // sneaks past (e.g. an inlined mapping in tests), the interpreter only
    // looks at the project role anyway.
    const m: ColumnMapping = {
      version: 1,
      entries: [
        { source: "question", questionKey: "p1", role: "project", label: "P", order: 0 },
        { source: "question", questionKey: "d1", role: "domain", label: "D", order: 1 },
        { source: "question", questionKey: "n1", role: "notes", label: "N", order: 2 },
      ],
    };
    const r = interpretBidForm({ p1: "proj_a", d1: "dom_x", n1: "ignored" }, m);
    expect(r).toEqual({ ok: true, bids: [{ projectId: "proj_a" }] });
  });
});
