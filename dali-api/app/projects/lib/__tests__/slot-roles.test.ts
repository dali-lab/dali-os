import { describe, it, expect } from "vitest";
import {
  missingRequirements,
  parseColumnMapping,
  validateMapping,
  type ColumnMapping,
  type ColumnMappingEntry,
} from "../slot-roles";
import type { Question } from "~/types";

function q(
  key: string,
  type: Question["type"],
  extra: Partial<Question["data"]> = {},
): Question {
  return { key, type, required: false, data: { label: key, ...extra } };
}

const projQ = (k: string) =>
  q(k, "reference", { referenceSource: "projects:open-this-term" });

// Project-bids requires 3 ranked project columns + submitter + hiredRoles
// builtins. Tests that aren't probing required-slot logic shouldn't have to
// spell that out, so this helper appends the required pieces to a base set
// of entries.
function withBidRequirements(
  entries: ColumnMappingEntry[],
  opts: { skipProjects?: boolean; skipBuiltins?: boolean } = {},
): ColumnMapping {
  const next = [...entries];
  let order = next.length;
  if (!opts.skipProjects) {
    for (let i = 1; i <= 3; i++) {
      next.push({
        source: "question",
        questionKey: `__req_p${i}`,
        role: "project",
        label: `Required project ${i}`,
        order: order++,
      });
    }
  }
  if (!opts.skipBuiltins) {
    next.push({
      source: "builtin",
      builtin: "submitter",
      role: "submitter",
      label: "Submitted by",
      order: order++,
    });
    next.push({
      source: "builtin",
      builtin: "hiredRoles",
      role: "hiredRoles",
      label: "Hired roles",
      order: order++,
    });
  }
  return { version: 1, entries: next };
}

const REQ_PROJ_QS = [projQ("__req_p1"), projQ("__req_p2"), projQ("__req_p3")];

describe("parseColumnMapping", () => {
  it("rejects garbage / wrong version", () => {
    expect(parseColumnMapping(null)).toBeNull();
    expect(parseColumnMapping({})).toBeNull();
    expect(parseColumnMapping({ version: 2, entries: [] })).toBeNull();
    expect(parseColumnMapping({ version: 1, entries: "x" })).toBeNull();
  });

  it("rejects malformed entries", () => {
    expect(
      parseColumnMapping({ version: 1, entries: [{ role: "project" }] }),
    ).toBeNull();
  });

  it("rejects a non-number order / non-boolean hidden", () => {
    expect(
      parseColumnMapping({
        version: 1,
        entries: [
          { source: "question", questionKey: "p", role: "project", label: "P", order: "x" },
        ],
      }),
    ).toBeNull();
    expect(
      parseColumnMapping({
        version: 1,
        entries: [
          { source: "question", questionKey: "p", role: "project", label: "P", hidden: "yes" },
        ],
      }),
    ).toBeNull();
  });

  it("parses a well-formed mapping incl. termId/order/hidden", () => {
    const r = parseColumnMapping({
      version: 1,
      entries: [
        {
          source: "question",
          questionKey: "p",
          role: "project",
          label: "Project",
          order: 0,
        },
        {
          source: "question",
          questionKey: "s",
          role: "intent-status",
          label: "X",
          termId: "t1",
          order: 1,
          hidden: true,
        },
      ],
    });
    expect(r).toEqual({
      version: 1,
      entries: [
        {
          source: "question",
          questionKey: "p",
          role: "project",
          label: "Project",
          order: 0,
        },
        {
          source: "question",
          questionKey: "s",
          role: "intent-status",
          label: "X",
          termId: "t1",
          order: 1,
          hidden: true,
        },
      ],
    });
  });

  it("legacy entries with no `source`/`order` are question-sourced and keep array order", () => {
    const r = parseColumnMapping({
      version: 1,
      entries: [
        { questionKey: "p", role: "project", label: "P" },
        { questionKey: "x", role: "display", label: "X" },
      ],
    });
    expect(r).toEqual({
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "P", order: 0 },
        { source: "question", questionKey: "x", role: "display", label: "X", order: 1 },
      ],
    });
  });

  it("silently drops retired roles (domain/notes) from existing mappings", () => {
    const r = parseColumnMapping({
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "P", order: 0 },
        { source: "question", questionKey: "d", role: "domain", label: "D", order: 1 },
        { source: "question", questionKey: "n", role: "notes", label: "N", order: 2 },
      ],
    });
    expect(r?.entries.map((e) => e.role)).toEqual(["project"]);
  });

  it("parses a builtin (submitter) entry", () => {
    const r = parseColumnMapping({
      version: 1,
      entries: [
        { source: "builtin", builtin: "submitter", role: "submitter", label: "By" },
      ],
    });
    expect(r).toEqual({
      version: 1,
      entries: [
        {
          source: "builtin",
          builtin: "submitter",
          role: "submitter",
          label: "By",
          order: 0,
        },
      ],
    });
  });

  it("parses the hiredRoles builtin", () => {
    const r = parseColumnMapping({
      version: 1,
      entries: [
        {
          source: "builtin",
          builtin: "hiredRoles",
          role: "hiredRoles",
          label: "Hired roles",
        },
      ],
    });
    expect(r?.entries[0]).toMatchObject({
      source: "builtin",
      builtin: "hiredRoles",
    });
  });

  it("rejects a builtin entry with an unknown builtin name", () => {
    expect(
      parseColumnMapping({
        version: 1,
        entries: [
          { source: "builtin", builtin: "nope", role: "submitter", label: "x" },
        ],
      }),
    ).toBeNull();
  });

  it("rejects an unknown source discriminant", () => {
    expect(
      parseColumnMapping({
        version: 1,
        entries: [
          { source: "magic", questionKey: "p", role: "project", label: "x" },
        ],
      }),
    ).toBeNull();
  });
});

describe("validateMapping (project-bids)", () => {
  const qs = [projQ("p"), q("n", "textarea"), ...REQ_PROJ_QS];

  it("an absent or empty mapping is INVALID — projects 1/2/3 + submitter + hired roles are required", () => {
    const empty = validateMapping("project-bids", qs, null);
    expect(empty).toMatchObject({ ok: false });
    if (!empty.ok) {
      expect(empty.reason).toMatch(/Project \(3 more\)/);
      expect(empty.reason).toMatch(/Submitted by/);
      expect(empty.reason).toMatch(/Hired roles/);
    }
    expect(
      validateMapping("project-bids", qs, { version: 1, entries: [] }),
    ).toMatchObject({ ok: false });
  });

  it("a mapping with only 2 of 3 project columns is rejected with what's missing", () => {
    const r = validateMapping(
      "project-bids",
      [projQ("p1"), projQ("p2")],
      withBidRequirements(
        [
          { source: "question", questionKey: "p1", role: "project", label: "1st", order: 0 },
          { source: "question", questionKey: "p2", role: "project", label: "2nd", order: 1 },
        ],
        { skipProjects: true },
      ),
    );
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/Project \(1 more\)/);
  });

  it("missing only the builtins is rejected with both named", () => {
    const qs3 = [projQ("p1"), projQ("p2"), projQ("p3")];
    const r = validateMapping("project-bids", qs3, {
      version: 1,
      entries: [
        { source: "question", questionKey: "p1", role: "project", label: "1st", order: 0 },
        { source: "question", questionKey: "p2", role: "project", label: "2nd", order: 1 },
        { source: "question", questionKey: "p3", role: "project", label: "3rd", order: 2 },
      ],
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.reason).toMatch(/Submitted by/);
      expect(r.reason).toMatch(/Hired roles/);
    }
  });

  it("3 ranked project columns + submitter + hired roles is the minimal valid mapping", () => {
    const qs3 = [projQ("p1"), projQ("p2"), projQ("p3")];
    const r = validateMapping("project-bids", qs3, {
      version: 1,
      entries: [
        { source: "question", questionKey: "p1", role: "project", label: "1st", order: 0 },
        { source: "question", questionKey: "p2", role: "project", label: "2nd", order: 1 },
        { source: "question", questionKey: "p3", role: "project", label: "3rd", order: 2 },
        { source: "builtin", builtin: "submitter", role: "submitter", label: "By", order: 3 },
        { source: "builtin", builtin: "hiredRoles", role: "hiredRoles", label: "Hired roles", order: 4 },
      ],
    });
    expect(r).toEqual({ ok: true });
  });

  it("extra display columns alongside the required spine are accepted", () => {
    const qs3 = [projQ("p1"), projQ("p2"), projQ("p3"), q("n", "textarea")];
    const r = validateMapping("project-bids", qs3, {
      version: 1,
      entries: [
        { source: "question", questionKey: "p1", role: "project", label: "1st", order: 0 },
        { source: "question", questionKey: "p2", role: "project", label: "2nd", order: 1 },
        { source: "question", questionKey: "p3", role: "project", label: "3rd", order: 2 },
        { source: "question", questionKey: "n", role: "display", label: "Anything", order: 3 },
        { source: "builtin", builtin: "submitter", role: "submitter", label: "By", order: 4 },
        { source: "builtin", builtin: "hiredRoles", role: "hiredRoles", label: "Hired roles", order: 5 },
      ],
    });
    expect(r).toEqual({ ok: true });
  });

  it("still fails when a project column points at a non-reference question", () => {
    const r = validateMapping(
      "project-bids",
      [q("p", "text"), ...REQ_PROJ_QS],
      withBidRequirements(
        [
          { source: "question", questionKey: "p", role: "project", label: "P", order: 0 },
        ],
        { skipProjects: true },
      ),
    );
    // Only 1 project column, and the one supplied is non-reference. The
    // type mismatch is the per-entry failure that fires before completeness
    // is checked.
    expect(r).toMatchObject({ ok: false });
  });

  it("still fails when an entry points at a since-deleted question", () => {
    const r = validateMapping(
      "project-bids",
      qs,
      withBidRequirements([
        { source: "question", questionKey: "gone", role: "display", label: "P", order: 0 },
      ]),
    );
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/out of date/);
  });

  it("accepts a display column backed by any question type", () => {
    const r = validateMapping(
      "project-bids",
      qs,
      withBidRequirements([
        { source: "question", questionKey: "n", role: "display", label: "Anything", order: 0 },
      ]),
    );
    expect(r).toEqual({ ok: true });
  });

  it("rejects a question mapped to the submitter (person) role", () => {
    const r = validateMapping(
      "project-bids",
      qs,
      withBidRequirements(
        [{ source: "question", questionKey: "n", role: "submitter", label: "By", order: 0 }],
        { skipBuiltins: true },
      ),
    );
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects a submitter builtin pointed at a non-person role", () => {
    const r = validateMapping(
      "project-bids",
      qs,
      withBidRequirements(
        [
          {
            source: "builtin",
            builtin: "submitter",
            role: "project",
            label: "Project",
            order: 0,
          },
        ],
        { skipBuiltins: true },
      ),
    );
    expect(r).toMatchObject({ ok: false });
  });
});

describe("missingRequirements (project-bids)", () => {
  it("an empty mapping reports all required pieces", () => {
    expect(missingRequirements("project-bids", null)).toEqual([
      "Project (3 more)",
      "Submitted by",
      "Hired roles",
    ]);
  });

  it("counts down the project requirement as columns are added", () => {
    const m: ColumnMapping = {
      version: 1,
      entries: [
        { source: "question", questionKey: "p1", role: "project", label: "1", order: 0 },
        { source: "question", questionKey: "p2", role: "project", label: "2", order: 1 },
      ],
    };
    expect(missingRequirements("project-bids", m)).toEqual([
      "Project (1 more)",
      "Submitted by",
      "Hired roles",
    ]);
  });

  it("a fully-required mapping reports nothing missing", () => {
    const m: ColumnMapping = {
      version: 1,
      entries: [
        { source: "question", questionKey: "p1", role: "project", label: "1", order: 0 },
        { source: "question", questionKey: "p2", role: "project", label: "2", order: 1 },
        { source: "question", questionKey: "p3", role: "project", label: "3", order: 2 },
        { source: "builtin", builtin: "submitter", role: "submitter", label: "By", order: 3 },
        { source: "builtin", builtin: "hiredRoles", role: "hiredRoles", label: "Hired", order: 4 },
      ],
    };
    expect(missingRequirements("project-bids", m)).toEqual([]);
  });

  it("intent-to-work has no required pieces", () => {
    expect(missingRequirements("intent-to-work", null)).toEqual([]);
  });
});

describe("validateMapping (intent-to-work)", () => {
  const qs = [q("s1", "select"), q("s2", "select")];

  it("empty mapping is valid", () => {
    expect(
      validateMapping("intent-to-work", qs, { version: 1, entries: [] }),
    ).toEqual({ ok: true });
  });

  it("one status column per distinct term is valid", () => {
    const r = validateMapping("intent-to-work", qs, {
      version: 1,
      entries: [
        { source: "question", questionKey: "s1", role: "intent-status", label: "F", termId: "t1", order: 0 },
        { source: "question", questionKey: "s2", role: "intent-status", label: "W", termId: "t2", order: 1 },
      ],
    });
    expect(r).toEqual({ ok: true });
  });

  it("two status columns for the SAME term is still rejected", () => {
    const r = validateMapping("intent-to-work", qs, {
      version: 1,
      entries: [
        { source: "question", questionKey: "s1", role: "intent-status", label: "A", termId: "t1", order: 0 },
        { source: "question", questionKey: "s2", role: "intent-status", label: "B", termId: "t1", order: 1 },
      ],
    });
    expect(r).toMatchObject({ ok: false });
  });
});
