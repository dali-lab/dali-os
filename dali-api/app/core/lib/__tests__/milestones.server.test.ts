import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  termId: string;
  week: number;
  kind: "Milestone" | "Plan";
  title: string;
  notes: string | null;
  position: number;
  createdAt: number;
  owners: string[];
};

const s = vi.hoisted(() => ({
  rows: [] as Row[],
  terms: [] as { id: string; code: string; year: number; season: string }[],
  coreIds: new Set<string>(),
  seq: 0,
  audit: vi.fn(),
}));

function matches(r: Row, where: Record<string, unknown> = {}) {
  return Object.entries(where).every(([k, v]) => (r as never)[k] === v);
}

function present(r: Row) {
  return {
    ...r,
    owners: r.owners.map((id) => ({ userId: id, user: { id, firstName: id, lastName: null, daliEmail: null } })),
  };
}

const coreMilestone = {
  findMany: vi.fn(async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: unknown; distinct?: string[] } = {}) => {
    let out = s.rows.filter((r) => matches(r, where));
    out = [...out].sort((a, b) => a.week - b.week || a.position - b.position || a.createdAt - b.createdAt);
    void orderBy;
    return out.map(present);
  }),
  findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
    const r = s.rows.find((x) => x.id === where.id);
    return r ? present(r) : null;
  }),
  findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const out = s.rows.filter((r) => matches(r, where)).sort((a, b) => b.position - a.position);
    return out[0] ? present(out[0]) : null;
  }),
  create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
    const row: Row = {
      id: `m${++s.seq}`,
      termId: data.termId,
      week: data.week,
      kind: data.kind,
      title: data.title,
      notes: data.notes ?? null,
      position: data.position,
      createdAt: s.seq,
      owners: (data.owners?.create ?? []).map((o: { userId: string }) => o.userId),
    };
    s.rows.push(row);
    return present(row);
  }),
  update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
    const r = s.rows.find((x) => x.id === where.id)!;
    for (const k of ["title", "notes", "position", "week", "kind"]) if (k in data) (r as any)[k] = data[k];
    if (data.owners?.create) r.owners = data.owners.create.map((o: { userId: string }) => o.userId);
    return present(r);
  }),
  delete: vi.fn(async ({ where }: { where: { id: string } }) => {
    s.rows = s.rows.filter((r) => r.id !== where.id);
  }),
};

const prisma = {
  coreMilestone,
  coreMilestoneOwner: {
    deleteMany: vi.fn(async ({ where }: { where: { milestoneId: string } }) => {
      const r = s.rows.find((x) => x.id === where.milestoneId);
      if (r) r.owners = [];
    }),
  },
  term: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => s.terms.find((t) => t.id === where.id) ?? null),
    findMany: vi.fn(async ({ where }: { where: { season: string; year: number } }) =>
      s.terms.filter((t) => t.season === where.season && t.year === where.year),
    ),
  },
  coreAssignment: {
    findMany: vi.fn(async ({ where }: { where: { userId?: { in: string[] } } }) => {
      const ids = where.userId?.in ?? [...s.coreIds];
      return ids.filter((id) => s.coreIds.has(id)).map((userId) => ({ userId }));
    }),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
};

vi.mock("~/lib/db.server", () => ({ get prisma() { return prisma; } }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: s.audit }));
vi.mock("~/lib/core-cycle.server", () => ({ coreCycleTermIds: vi.fn(async (id: string) => [id]) }));
vi.mock("~/lib/core-members.server", () => ({
  personName: (u: { firstName: string | null }) => u.firstName ?? "Unknown",
}));

import {
  MilestoneError,
  createMilestone,
  deleteMilestone,
  fillTermFromLastYear,
  moveMilestone,
  updateMilestone,
} from "~/core/lib/milestones.server";

const actor = { userId: "admin1" };

function seed(termId: string, week: number, kind: "Milestone" | "Plan", titles: string[], owners: string[] = []) {
  titles.forEach((title, position) =>
    s.rows.push({
      id: `${termId}-${week}-${kind}-${title}`,
      termId,
      week,
      kind,
      title,
      notes: "old notes",
      position,
      createdAt: ++s.seq,
      owners,
    }),
  );
}

const section = (termId: string, week: number, kind: string) =>
  s.rows
    .filter((r) => r.termId === termId && r.week === week && r.kind === kind)
    .sort((a, b) => a.position - b.position)
    .map((r) => r.title);

beforeEach(() => {
  s.rows = [];
  s.seq = 0;
  s.coreIds = new Set(["ada", "bo"]);
  s.terms = [
    { id: "t26F", code: "26F", year: 2026, season: "F" },
    { id: "t25F", code: "25F", year: 2025, season: "F" },
    { id: "t26X", code: "26X", year: 2026, season: "X" },
  ];
  s.audit.mockClear();
});

describe("createMilestone", () => {
  it("appends to the end of the week's section and logs it", async () => {
    seed("t26F", 2, "Milestone", ["a", "b"]);
    const item = await createMilestone({ termId: "t26F", week: 2, title: " c " }, actor);
    expect(item.title).toBe("c");
    expect(section("t26F", 2, "Milestone")).toEqual(["a", "b", "c"]);
    expect(s.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "core.milestone.create", userId: "admin1" }));
  });

  it("keeps the two kinds' positions separate", async () => {
    seed("t26F", 2, "Milestone", ["a", "b"]);
    await createMilestone({ termId: "t26F", week: 2, kind: "Plan", title: "p" }, actor);
    expect(s.rows.find((r) => r.title === "p")!.position).toBe(0);
  });

  it("rejects a week outside 0 to 10 and a blank title", async () => {
    await expect(createMilestone({ termId: "t26F", week: 11, title: "x" }, actor)).rejects.toThrow(MilestoneError);
    await expect(createMilestone({ termId: "t26F", week: -1, title: "x" }, actor)).rejects.toThrow(MilestoneError);
    await expect(createMilestone({ termId: "t26F", week: 1, title: "  " }, actor)).rejects.toThrow(MilestoneError);
    expect(s.rows).toHaveLength(0);
  });

  it("rejects an owner who isn't Core that term", async () => {
    await expect(
      createMilestone({ termId: "t26F", week: 1, title: "x", ownerIds: ["ada", "stranger"] }, actor),
    ).rejects.toThrow("Owners must be current Core members");
    expect(s.rows).toHaveLength(0);
  });

  it("stores Core owners", async () => {
    const item = await createMilestone({ termId: "t26F", week: 1, title: "x", ownerIds: ["ada"] }, actor);
    expect(item.owners).toEqual([{ id: "ada", name: "ada" }]);
  });
});

describe("updateMilestone", () => {
  it("deletes the row when the title is cleared and closes the gap", async () => {
    seed("t26F", 2, "Milestone", ["a", "b", "c"]);
    const result = await updateMilestone({ id: "t26F-2-Milestone-a", title: "  " }, actor);
    expect(result).toEqual({ deleted: true });
    expect(section("t26F", 2, "Milestone")).toEqual(["b", "c"]);
    expect(s.rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it("moves an item to the end of the other section when its kind changes", async () => {
    seed("t26F", 2, "Milestone", ["a", "b", "c"]);
    seed("t26F", 2, "Plan", ["p1"]);
    await updateMilestone({ id: "t26F-2-Milestone-a", kind: "Plan" }, actor);
    expect(section("t26F", 2, "Plan")).toEqual(["p1", "a"]);
    expect(section("t26F", 2, "Milestone")).toEqual(["b", "c"]);
  });

  it("rejects non-Core owners and unknown ids", async () => {
    seed("t26F", 2, "Milestone", ["a"]);
    await expect(updateMilestone({ id: "t26F-2-Milestone-a", ownerIds: ["stranger"] }, actor)).rejects.toThrow(
      MilestoneError,
    );
    await expect(updateMilestone({ id: "nope", title: "x" }, actor)).rejects.toMatchObject({ status: 404 });
  });

  it("replaces owners, and an empty list means the whole lab", async () => {
    seed("t26F", 2, "Milestone", ["a"], ["ada"]);
    await updateMilestone({ id: "t26F-2-Milestone-a", ownerIds: ["bo"] }, actor);
    expect(s.rows[0].owners).toEqual(["bo"]);
    await updateMilestone({ id: "t26F-2-Milestone-a", ownerIds: [] }, actor);
    expect(s.rows[0].owners).toEqual([]);
  });
});

describe("moveMilestone", () => {
  it("reorders within a section", async () => {
    seed("t26F", 2, "Milestone", ["a", "b", "c"]);
    await moveMilestone({ id: "t26F-2-Milestone-c", toWeek: 2, toPosition: 0 }, actor);
    expect(section("t26F", 2, "Milestone")).toEqual(["c", "a", "b"]);
  });

  it("appends in the target week and closes the gap in the source", async () => {
    seed("t26F", 2, "Milestone", ["a", "b", "c"]);
    seed("t26F", 5, "Milestone", ["x"]);
    await moveMilestone({ id: "t26F-2-Milestone-a", toWeek: 5 }, actor);
    expect(section("t26F", 5, "Milestone")).toEqual(["x", "a"]);
    expect(section("t26F", 2, "Milestone")).toEqual(["b", "c"]);
    expect(s.rows.filter((r) => r.week === 2).map((r) => r.position)).toEqual([0, 1]);
  });

  it("rejects another term, a bad week and an unknown id", async () => {
    seed("t26F", 2, "Milestone", ["a"]);
    await expect(moveMilestone({ id: "t26F-2-Milestone-a", toWeek: 3, termId: "t25F" }, actor)).rejects.toThrow(
      "within its term",
    );
    await expect(moveMilestone({ id: "t26F-2-Milestone-a", toWeek: 11 }, actor)).rejects.toThrow(MilestoneError);
    await expect(moveMilestone({ id: "nope", toWeek: 1 }, actor)).rejects.toMatchObject({ status: 404 });
    expect(s.rows[0].week).toBe(2);
  });
});

describe("deleteMilestone", () => {
  it("deletes, closes the gap and logs", async () => {
    seed("t26F", 2, "Plan", ["a", "b"]);
    await deleteMilestone("t26F-2-Plan-a", actor);
    expect(section("t26F", 2, "Plan")).toEqual(["b"]);
    expect(s.rows[0].position).toBe(0);
    expect(s.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "core.milestone.delete" }));
  });
});

describe("fillTermFromLastYear", () => {
  it("copies both kinds into empty weeks only, in order, with empty notes", async () => {
    seed("t25F", 1, "Milestone", ["m1", "m2"], ["ada"]);
    seed("t25F", 1, "Plan", ["p1"]);
    seed("t25F", 2, "Milestone", ["skip"]);
    seed("t26F", 2, "Milestone", ["existing"]);
    const result = await fillTermFromLastYear("t26F", actor);
    expect(result).toEqual({ copied: 3 });
    expect(section("t26F", 1, "Milestone")).toEqual(["m1", "m2"]);
    expect(section("t26F", 1, "Plan")).toEqual(["p1"]);
    expect(section("t26F", 2, "Milestone")).toEqual(["existing"]);
    const copied = s.rows.filter((r) => r.termId === "t26F" && r.week === 1);
    expect(copied.every((r) => r.notes === null)).toBe(true);
    expect(copied.find((r) => r.title === "m1")!.owners).toEqual(["ada"]);
  });

  it("adds nothing when run again", async () => {
    seed("t25F", 1, "Milestone", ["m1"]);
    await fillTermFromLastYear("t26F", actor);
    const before = s.rows.length;
    expect(await fillTermFromLastYear("t26F", actor)).toEqual({ copied: 0 });
    expect(s.rows).toHaveLength(before);
  });

  it("drops owners who aren't Core this term", async () => {
    seed("t25F", 1, "Milestone", ["m1"], ["ada", "gone"]);
    await fillTermFromLastYear("t26F", actor);
    expect(s.rows.find((r) => r.termId === "t26F")!.owners).toEqual(["ada"]);
  });

  it("uses last summer for a summer term and rejects when there is none", async () => {
    await expect(fillTermFromLastYear("t26X", actor)).rejects.toThrow("no term from last year");
    await expect(fillTermFromLastYear("missing", actor)).rejects.toMatchObject({ status: 404 });
  });
});
