import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    staffingCycleFormBinding: { findFirst: vi.fn() },
    formVersion: { findFirst: vi.fn() },
    formSubmission: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    domain: { findMany: vi.fn() },
    domainEligibility: { findMany: vi.fn() },
    staffingCycle: { findUnique: vi.fn() },
  },
}));

import { prisma } from "~/lib/db.server";
import { buildSubmissionView } from "../submission-view.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const QUESTIONS = [
  { key: "q1", type: "reference", data: { label: "First choice" } },
  { key: "q2", type: "checkbox", data: { label: "Days" } },
  { key: "q3", type: "text", data: { label: "Notes" } },
];

const MAPPING = {
  version: 1,
  entries: [
    { role: "project", label: "Project", source: "question", questionKey: "q1", order: 1 },
    { role: "status", label: "Status {{term}}", source: "question", questionKey: "q3", order: 2, hidden: true },
    { role: "submitter", label: "Person", source: "builtin", builtin: "submitter", order: 0 },
  ],
};

function sub(userId: string | null, first: string, last: string, answers: Record<string, unknown>, email: string | null = null) {
  return { userId, answers, user: { firstName: first, lastName: last, daliEmail: email } };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.staffingCycleFormBinding.findFirst.mockResolvedValue({ columnMapping: MAPPING });
  db.formVersion.findFirst.mockResolvedValue({ questions: QUESTIONS });
  db.formSubmission.findMany.mockResolvedValue([]);
  db.project.findMany.mockResolvedValue([]);
  db.domain.findMany.mockResolvedValue([]);
  db.domainEligibility.findMany.mockResolvedValue([]);
  db.staffingCycle.findUnique.mockResolvedValue({ term: { code: "27S" } });
});

describe("buildSubmissionView lookups", () => {
  it("without a form, has no mapping, columns or questions and skips those queries", async () => {
    db.formSubmission.findMany.mockResolvedValue([sub("u1", "Ada", "Lovelace", { q3: "hi" })]);
    const view = await buildSubmissionView({ cycleIds: ["c1"], slot: "intent-to-work" as never, formId: null });
    expect(db.staffingCycleFormBinding.findFirst).not.toHaveBeenCalled();
    expect(db.formVersion.findFirst).not.toHaveBeenCalled();
    expect(view.mapping).toBeNull();
    expect(view.allColumns).toEqual([]);
    expect(view.rows[0].detailFields.map((f) => f.key)).toEqual(["builtin:submitter", "builtin:hiredRoles"]);
  });

  it("reads the binding for the given cycles and slot, and the newest form version", async () => {
    await buildSubmissionView({ cycleIds: ["c1", "c2"], slot: "project-bids" as never, formId: "f1" });
    expect(db.staffingCycleFormBinding.findFirst.mock.calls[0][0].where).toEqual({
      formId: "f1",
      slot: "project-bids",
      staffingCycleId: { in: ["c1", "c2"] },
    });
    expect(db.formVersion.findFirst.mock.calls[0][0]).toMatchObject({
      where: { form: { id: "f1" } },
      orderBy: { versionNumber: "desc" },
    });
  });

  it("only fetches submissions with a user, or just the requested member's", async () => {
    await buildSubmissionView({ cycleIds: ["c1"], slot: "project-bids" as never, formId: "f1" });
    expect(db.formSubmission.findMany.mock.calls[0][0].where).toEqual({
      staffingCycleId: { in: ["c1"] },
      slot: "project-bids",
      userId: { not: null },
    });
    await buildSubmissionView({ cycleIds: ["c1"], slot: "project-bids" as never, formId: "f1", userId: "u9" });
    expect(db.formSubmission.findMany.mock.calls[1][0].where.userId).toBe("u9");
  });
});

describe("buildSubmissionView rows", () => {
  it("keeps only each member's newest submission and sorts rows by name", async () => {
    db.formSubmission.findMany.mockResolvedValue([
      sub("u2", "Grace", "Hopper", { q3: "new" }),
      sub("u1", "Ada", "Lovelace", { q3: "newest" }),
      sub("u2", "Grace", "Hopper", { q3: "old" }),
      sub(null, "Ghost", "User", {}),
    ]);
    const view = await buildSubmissionView({ cycleIds: ["c1"], slot: "project-bids" as never, formId: "f1" });
    expect(view.rows.map((r) => r.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    const grace = view.rows[1];
    expect(grace.detailFields.find((f) => f.key === "q:q3")?.value).toBe("new");
  });

  it("resolves reference answers to project or domain names, falling back to the raw id", async () => {
    db.formSubmission.findMany.mockResolvedValue([
      sub("u1", "Ada", "Lovelace", { q1: "proj-1" }),
      sub("u2", "Grace", "Hopper", { q1: "dom-1" }),
      sub("u3", "Alan", "Turing", { q1: "unknown-id" }),
    ]);
    db.project.findMany.mockResolvedValue([{ id: "proj-1", name: "Example Project" }]);
    db.domain.findMany.mockResolvedValue([{ id: "dom-1", displayName: "Engineering" }]);
    const view = await buildSubmissionView({ cycleIds: ["c1"], slot: "project-bids" as never, formId: "f1" });
    const byName = Object.fromEntries(view.rows.map((r) => [r.name, r.detailFields.find((f) => f.key === "q:q1")?.value]));
    expect(byName).toEqual({ "Ada Lovelace": "Example Project", "Grace Hopper": "Engineering", "Alan Turing": "unknown-id" });
    expect(db.project.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(["dom-1", "proj-1", "unknown-id"]);
  });

  it("skips the name lookups when no reference answer is present", async () => {
    db.formSubmission.findMany.mockResolvedValue([sub("u1", "Ada", "Lovelace", { q3: "x" })]);
    await buildSubmissionView({ cycleIds: ["c1"], slot: "project-bids" as never, formId: "f1" });
    expect(db.project.findMany).not.toHaveBeenCalled();
    expect(db.domain.findMany).not.toHaveBeenCalled();
  });

  it("stringifies arrays as comma lists, objects as JSON and blanks as empty", async () => {
    db.formSubmission.findMany.mockResolvedValue([
      sub("u1", "Ada", "Lovelace", { q2: ["Mon", "Tue"], q3: { a: 1 } }),
      sub("u2", "Grace", "Hopper", { q2: "", q3: null }),
    ]);
    const view = await buildSubmissionView({ cycleIds: ["c1"], slot: "project-bids" as never, formId: "f1" });
    const val = (i: number, k: string) => view.rows[i].detailFields.find((f) => f.key === k)?.value;
    expect(val(0, "q:q2")).toBe("Mon, Tue");
    expect(val(0, "q:q3")).toBe('{"a":1}');
    expect(val(1, "q:q2")).toBe("");
    expect(val(1, "q:q3")).toBe("");
  });

  it("builds hired roles and domain ids from the member's eligibilities", async () => {
    db.formSubmission.findMany.mockResolvedValue([sub("u1", "Ada", "Lovelace", {}, "ada@example.edu")]);
    db.domainEligibility.findMany.mockResolvedValue([
      { userId: "u1", level: "P2", domainId: "eng", domain: { displayName: "Engineering" } },
      { userId: "u1", level: "P1", domainId: "des", domain: { displayName: "Design" } },
    ]);
    const view = await buildSubmissionView({ cycleIds: ["c1"], slot: "project-bids" as never, formId: "f1" });
    const row = view.rows[0];
    expect(row.email).toBe("ada@example.edu");
    expect(row.domainIds).toEqual(["eng", "des"]);
    expect(row.detailFields.find((f) => f.key === "builtin:hiredRoles")?.value).toBe("Engineering (P2), Design (P1)");
    expect(db.domainEligibility.findMany.mock.calls[0][0].where).toEqual({ userId: { in: ["u1"] } });
  });

  it("detail fields list form questions in order then builtins, flagging which the mapping covers", async () => {
    db.formSubmission.findMany.mockResolvedValue([sub("u1", "Ada", "Lovelace", {})]);
    const view = await buildSubmissionView({ cycleIds: ["c1"], slot: "project-bids" as never, formId: "f1" });
    expect(view.rows[0].detailFields.map((f) => [f.key, f.source, f.mapped])).toEqual([
      ["q:q1", "question", true],
      ["q:q2", "question", false],
      ["q:q3", "question", true],
      ["builtin:submitter", "builtin", true],
      ["builtin:hiredRoles", "builtin", false],
    ]);
  });
});

describe("buildSubmissionView columns", () => {
  it("orders columns by mapping order, hides hidden ones from the table only, and fills cells for all", async () => {
    db.formSubmission.findMany.mockResolvedValue([sub("u1", "Ada", "Lovelace", { q1: "proj-1", q3: "note" })]);
    db.project.findMany.mockResolvedValue([{ id: "proj-1", name: "Example Project" }]);
    const view = await buildSubmissionView({ cycleIds: ["c1"], slot: "project-bids" as never, formId: "f1" });
    expect(view.allColumns.map((c) => c.key)).toEqual(["builtin:submitter", "q:q1", "q:q3"]);
    expect(view.tableColumns.map((c) => c.key)).toEqual(["builtin:submitter", "q:q1"]);
    expect(view.rows[0].cells).toEqual({
      "builtin:submitter": "Ada Lovelace",
      "q:q1": "Example Project",
      "q:q3": "note",
    });
  });

  it("substitutes the cycle's term code into labels for a single cycle", async () => {
    const view = await buildSubmissionView({ cycleIds: ["c1"], slot: "project-bids" as never, formId: "f1" });
    expect(db.staffingCycle.findUnique.mock.calls[0][0].where).toEqual({ id: "c1" });
    expect(view.allColumns.find((c) => c.key === "q:q3")?.label).toBe("Status 27S");
  });

  it("leaves {{term}} literal for the all-terms aggregate and does not look up a term", async () => {
    const view = await buildSubmissionView({ cycleIds: ["c1", "c2"], slot: "project-bids" as never, formId: "f1" });
    expect(db.staffingCycle.findUnique).not.toHaveBeenCalled();
    expect(view.allColumns.find((c) => c.key === "q:q3")?.label).toBe("Status {{term}}");
  });
});
