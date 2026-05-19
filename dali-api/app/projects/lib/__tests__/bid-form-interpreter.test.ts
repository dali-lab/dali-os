import { describe, it, expect } from "vitest";
import { interpretBidForm } from "../bid-form-interpreter";
import type { ColumnMapping, ColumnMappingEntry } from "../slot-roles";

// Mapping helper: ranked groups of project/domain/notes question keys.
function mapping(
  groups: { project: string; domain?: string; notes?: string }[],
): ColumnMapping {
  const entries = groups.flatMap((g, i) => {
    const out: ColumnMappingEntry[] = [
      { source: "question", questionKey: g.project, role: "project", label: `P${i + 1}` },
    ];
    if (g.domain)
      out.push({ source: "question", questionKey: g.domain, role: "domain", label: `D${i + 1}` });
    if (g.notes)
      out.push({ source: "question", questionKey: g.notes, role: "notes", label: `N${i + 1}` });
    return out;
  });
  return { version: 1, entries };
}

describe("interpretBidForm (mapping-driven)", () => {
  it("interprets a single bid with notes", () => {
    const m = mapping([{ project: "p1", domain: "d1", notes: "n1" }]);
    const r = interpretBidForm(
      { p1: "proj_a", d1: "dom_dev", n1: "  keen  " },
      m,
    );
    expect(r).toEqual({
      ok: true,
      bids: [{ projectId: "proj_a", domainId: "dom_dev", notes: "keen" }],
    });
  });

  it("ignores a builtin (submitter) entry — it carries no bid answer", () => {
    const m: ColumnMapping = {
      version: 1,
      entries: [
        {
          source: "builtin",
          builtin: "submitter",
          role: "submitter",
          label: "By",
        },
        { source: "question", questionKey: "p1", role: "project", label: "P1" },
        { source: "question", questionKey: "d1", role: "domain", label: "D1" },
      ],
    };
    const r = interpretBidForm({ p1: "proj_a", d1: "dom_dev" }, m);
    expect(r).toEqual({
      ok: true,
      bids: [{ projectId: "proj_a", domainId: "dom_dev", notes: null }],
    });
  });

  it("ranks bids by order of project entries in the mapping", () => {
    const m = mapping([
      { project: "p1", domain: "d1", notes: "n1" },
      { project: "p2", domain: "d2" },
      { project: "p3", domain: "d3" },
    ]);
    const r = interpretBidForm(
      {
        p1: "proj_a",
        d1: "dom_dev",
        n1: "first",
        p2: "proj_b",
        d2: "dom_design",
        p3: "proj_c",
        d3: "dom_pm",
      },
      m,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bids).toEqual([
        { projectId: "proj_a", domainId: "dom_dev", notes: "first" },
        { projectId: "proj_b", domainId: "dom_design", notes: null },
        { projectId: "proj_c", domainId: "dom_pm", notes: null },
      ]);
    }
  });

  it("drops a fully-empty (skipped optional) group", () => {
    const m = mapping([
      { project: "p1", domain: "d1" },
      { project: "p2", domain: "d2" },
    ]);
    const r = interpretBidForm({ p1: "proj_a", d1: "dom_dev" }, m);
    expect(r).toEqual({
      ok: true,
      bids: [{ projectId: "proj_a", domainId: "dom_dev", notes: null }],
    });
  });

  it("errors when one side of a bid is filled and the other blank", () => {
    const m = mapping([{ project: "p1", domain: "d1" }]);
    const r = interpretBidForm({ p1: "proj_a" }, m);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/Incomplete bid/);
  });

  it("errors when nothing was submitted", () => {
    const m = mapping([{ project: "p1", domain: "d1" }]);
    const r = interpretBidForm({}, m);
    expect(r).toMatchObject({ ok: false });
  });

  it("ignores answers for questions not in the mapping", () => {
    const m = mapping([{ project: "p1", domain: "d1" }]);
    const r = interpretBidForm(
      { intro: "ignored", p1: "proj_a", d1: "dom_dev" },
      m,
    );
    expect(r).toEqual({
      ok: true,
      bids: [{ projectId: "proj_a", domainId: "dom_dev", notes: null }],
    });
  });
});
