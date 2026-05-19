import { describe, it, expect } from "vitest";
import { parseColumnMapping, validateMapping } from "../slot-roles";
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
const domQ = (k: string) =>
  q(k, "reference", { referenceSource: "domains:active" });

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

  it("parses a well-formed mapping incl. optional termId", () => {
    const r = parseColumnMapping({
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "Project" },
        {
          source: "question",
          questionKey: "s",
          role: "intent-status",
          label: "X",
          termId: "t1",
        },
      ],
    });
    expect(r).toEqual({
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "Project" },
        {
          source: "question",
          questionKey: "s",
          role: "intent-status",
          label: "X",
          termId: "t1",
        },
      ],
    });
  });

  it("back-compat: legacy entries with no `source` are read as question-sourced", () => {
    const r = parseColumnMapping({
      version: 1,
      entries: [{ questionKey: "p", role: "project", label: "P" }],
    });
    expect(r).toEqual({
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "P" },
      ],
    });
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
        { source: "builtin", builtin: "submitter", role: "submitter", label: "By" },
      ],
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
  const qs = [projQ("p"), domQ("d"), q("n", "textarea")];

  it("fails when no mapping", () => {
    const r = validateMapping("project-bids", qs, null);
    expect(r.ok).toBe(false);
  });

  it("fails when a required role is unmapped", () => {
    const r = validateMapping("project-bids", qs, {
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "P" },
      ],
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/Domain/);
  });

  it("fails when project role points at a non-reference question", () => {
    const r = validateMapping("project-bids", [q("p", "text"), domQ("d")], {
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "P" },
        { source: "question", questionKey: "d", role: "domain", label: "D" },
      ],
    });
    expect(r).toMatchObject({ ok: false });
  });

  it("fails when an entry points at a since-deleted question", () => {
    const r = validateMapping("project-bids", qs, {
      version: 1,
      entries: [
        { source: "question", questionKey: "gone", role: "project", label: "P" },
        { source: "question", questionKey: "d", role: "domain", label: "D" },
      ],
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/out of date/);
  });

  it("passes a valid project/domain/notes mapping", () => {
    const r = validateMapping("project-bids", qs, {
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "Project" },
        { source: "question", questionKey: "d", role: "domain", label: "Domain" },
        { source: "question", questionKey: "n", role: "notes", label: "Notes" },
      ],
    });
    expect(r).toEqual({ ok: true });
  });

  it("accepts a submitter builtin entry alongside questions (both slots)", () => {
    const r = validateMapping("project-bids", qs, {
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "Project" },
        { source: "question", questionKey: "d", role: "domain", label: "Domain" },
        {
          source: "builtin",
          builtin: "submitter",
          role: "submitter",
          label: "Submitted by",
        },
      ],
    });
    expect(r).toEqual({ ok: true });

    // Submitter is optional, so a mapping without it still validates.
    const noSubmitter = validateMapping("project-bids", qs, {
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "Project" },
        { source: "question", questionKey: "d", role: "domain", label: "Domain" },
      ],
    });
    expect(noSubmitter).toEqual({ ok: true });
  });

  it("rejects a question mapped to the submitter (person) role", () => {
    const r = validateMapping("project-bids", qs, {
      version: 1,
      entries: [
        { source: "question", questionKey: "p", role: "project", label: "Project" },
        { source: "question", questionKey: "d", role: "domain", label: "Domain" },
        // A question can never fill a person role.
        { source: "question", questionKey: "n", role: "submitter", label: "By" },
      ],
    });
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects a submitter builtin pointed at a non-person role", () => {
    const r = validateMapping("project-bids", qs, {
      version: 1,
      entries: [
        {
          source: "builtin",
          builtin: "submitter",
          role: "project",
          label: "Project",
        },
        { source: "question", questionKey: "d", role: "domain", label: "Domain" },
      ],
    });
    expect(r).toMatchObject({ ok: false });
  });
});
