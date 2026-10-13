import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, any>;

// In-memory stand-in for the slice of Prisma that sprints.server.ts uses, so
// these tests assert resulting state rather than call shapes.
const db: Record<string, Row[]> = {};
let seq = 0;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "term") return matches(db.term!.find((t) => t.id === row.termId)!, cond);
    const v = row[k];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (typeof cond === "object") {
      const cmp = (x: any) => (x instanceof Date ? x.getTime() : x);
      if ("in" in cond) return cond.in.includes(v);
      if ("gte" in cond && !(cmp(v) >= cmp(cond.gte))) return false;
      if ("gt" in cond && !(cmp(v) > cmp(cond.gt))) return false;
      if ("lt" in cond && !(cmp(v) < cmp(cond.lt))) return false;
      return true;
    }
    return v === cond;
  });
}

function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && "increment" in v) row[k] = (row[k] ?? 0) + v.increment;
    else row[k] = v;
  }
}

function order(rows: Row[], orderBy?: Row) {
  if (!orderBy) return rows;
  const [k, dir] = Object.entries(orderBy)[0]!;
  const cmp = (x: any) => (x instanceof Date ? x.getTime() : x);
  return [...rows].sort((a, z) => (cmp(a[k]) - cmp(z[k])) * (dir === "desc" ? -1 : 1));
}

function table(name: string) {
  const rows = () => (db[name] ??= []);
  return {
    findMany: vi.fn(async ({ where, orderBy }: Row = {}) =>
      order(rows().filter((r) => matches(r, where)), orderBy).map((r) => withRelations(name, r)),
    ),
    findFirst: vi.fn(async ({ where, orderBy }: Row = {}) => {
      const r = order(rows().filter((x) => matches(x, where)), orderBy)[0];
      return r ? withRelations(name, r) : null;
    }),
    findUnique: vi.fn(async ({ where }: Row) => rows().find((r) => matches(r, where)) ?? null),
    count: vi.fn(async ({ where }: Row) => rows().filter((r) => matches(r, where)).length),
    create: vi.fn(async ({ data }: Row) => {
      if (name === "sprint") assertSprintUnique(data);
      const r = { id: `${name}${++seq}`, closedAt: null, ...data };
      rows().push(r);
      return r;
    }),
    createMany: vi.fn(async ({ data }: Row) => {
      for (const d of data) {
        if (name === "sprintTaskSnapshot" && rows().some((r) => r.sprintId === d.sprintId && r.taskId === d.taskId)) continue;
        if (name === "sprint") assertSprintUnique(d);
        rows().push({ id: `${name}${++seq}`, closedAt: null, ...d });
      }
      return { count: data.length };
    }),
    update: vi.fn(async ({ where, data }: Row) => {
      const r = name === "projectTerm"
        ? rows().find((x) => x.projectId === where.projectId_termId.projectId && x.termId === where.projectId_termId.termId)
        : rows().find((x) => matches(x, where));
      if (!r) throw new Error(`${name} not found`);
      applyData(r, data);
      return withRelations(name, r);
    }),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      const hit = rows().filter((r) => matches(r, where));
      hit.forEach((r) => applyData(r, data));
      return { count: hit.length };
    }),
    deleteMany: vi.fn(async ({ where }: Row) => {
      const gone = rows().filter((r) => matches(r, where));
      db[name] = rows().filter((r) => !gone.includes(r));
      for (const g of gone) if (name === "sprint") db.task!.forEach((t) => t.sprintId === g.id && (t.sprintId = null));
      return { count: gone.length };
    }),
    aggregate: vi.fn(async ({ where }: Row) => ({
      _max: { position: Math.max(-1, ...rows().filter((r) => matches(r, where)).map((r) => r.position ?? 0)) },
    })),
  };
}

function assertSprintUnique(d: Row) {
  const clash = (db.sprint ?? []).some(
    (s) =>
      s.projectId === d.projectId &&
      (s.startsOn.getTime() === d.startsOn.getTime() || (s.termId === d.termId && s.number === d.number)),
  );
  if (clash) throw new Error("Unique constraint failed on Sprint");
}

function withRelations(name: string, r: Row): Row {
  if (name === "projectTerm") return { ...r, term: db.term!.find((t) => t.id === r.termId) };
  if (name === "task") return { ...r, story: r.storyId ? db.userStory!.find((s) => s.id === r.storyId) : null };
  return r;
}

vi.mock("~/lib/db", () => {
  const prisma: Row = {};
  for (const n of ["projectTerm", "sprint", "project", "epic", "task", "sprintTaskSnapshot", "term", "userStory"]) {
    prisma[n] = table(n);
  }
  prisma.$transaction = vi.fn(async (fn: (tx: Row) => unknown) => fn(prisma));
  return { prisma };
});

import {
  backfillProjectTasks,
  closeEndedSprints,
  ensureSprints,
  getOrCreateGeneralEpic,
  setSprintAnchor,
} from "../sprints.server";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
// Noon ET on the given date.
const at = (iso: string) => new Date(`${iso}T16:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

// 26F stored with a local-midnight (EDT) offset, as Term rows are.
const FALL = { id: "26F", startDate: new Date("2026-09-16T04:00:00Z"), endDate: new Date("2026-11-24T05:00:00Z") };
const SUMMER = { id: "26X", startDate: new Date("2026-06-22T04:00:00Z"), endDate: new Date("2026-08-28T04:00:00Z") };

function task(id: string, extra: Row = {}): Row {
  return {
    id,
    projectId: "p1",
    status: "Todo",
    epicId: "e1",
    storyId: null,
    sprintId: null,
    carryoverCount: 0,
    archivedAt: null,
    dueAt: null,
    startsAt: null,
    ...extra,
  };
}

function sprintsOf(termId = "26F") {
  return [...db.sprint!].filter((s) => s.termId === termId).sort((a, z) => a.startsOn - z.startsOn);
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  seq = 0;
  db.term = [FALL, SUMMER];
  db.project = [{ id: "p1", sprintsBackfilledAt: new Date("2026-01-01") }];
  db.projectTerm = [
    { projectId: "p1", termId: "26X", sprintAnchorDay: null },
    { projectId: "p1", termId: "26F", sprintAnchorDay: null },
  ];
  db.epic = [{ id: "e1", projectId: "p1", title: "Auth", position: 0, createdAt: new Date(0) }];
  db.userStory = [];
  db.task = [];
  db.sprint = [];
  db.sprintTaskSnapshot = [];
});

describe("ensureSprints", () => {
  it("creates current/future terms' sprints only, anchored to the term-start weekday", async () => {
    await ensureSprints("p1", at("2026-10-12"));
    expect(db.sprint!.every((s) => s.termId === "26F")).toBe(true);
    const fall = sprintsOf();
    expect(fall).toHaveLength(10);
    expect(fmt(fall[0]!.startsOn)).toBe("2026-09-16");
    expect(fall.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("is idempotent", async () => {
    await ensureSprints("p1", at("2026-10-12"));
    await ensureSprints("p1", at("2026-10-12"));
    expect(db.sprint).toHaveLength(10);
  });

  it("honors a set anchor day", async () => {
    db.projectTerm![1]!.sprintAnchorDay = 1;
    await ensureSprints("p1", at("2026-10-12"));
    expect(fmt(sprintsOf()[0]!.startsOn)).toBe("2026-09-21");
  });
});

describe("closeEndedSprints", () => {
  beforeEach(async () => {
    await ensureSprints("p1", at("2026-09-20"));
  });

  it("snapshots, rolls unfinished work to the next sprint, and counts", async () => {
    const [s1, s2] = sprintsOf();
    db.task = [
      task("done", { sprintId: s1!.id, status: "Done" }),
      task("cancelled", { sprintId: s1!.id, status: "Cancelled" }),
      task("todo", { sprintId: s1!.id, status: "Todo" }),
      task("wip", { sprintId: s1!.id, status: "InProgress" }),
      task("review", { sprintId: s1!.id, status: "InReview" }),
      task("archived", { sprintId: s1!.id, status: "Done", archivedAt: new Date() }),
    ];
    const closed = await closeEndedSprints("p1", at("2026-09-23"));
    expect(closed.map((c) => c.id)).toEqual([s1!.id]);
    expect(closed[0]).toMatchObject({ planned: 5, completed: 1, carried: 3, nextSprintId: s2!.id });

    const byId = Object.fromEntries(db.task!.map((t) => [t.id, t]));
    expect(byId.done).toMatchObject({ sprintId: s1!.id, carryoverCount: 0 });
    expect(byId.cancelled).toMatchObject({ sprintId: s1!.id, carryoverCount: 0 });
    for (const id of ["todo", "wip", "review"]) {
      expect(byId[id]).toMatchObject({ sprintId: s2!.id, carryoverCount: 1 });
    }
    expect(byId.wip!.status).toBe("InProgress");

    const snaps = Object.fromEntries(db.sprintTaskSnapshot!.map((s) => [s.taskId, s]));
    expect(Object.keys(snaps).sort()).toEqual(["cancelled", "done", "review", "todo", "wip"]);
    expect(snaps.done).toMatchObject({ statusAtClose: "Done", carriedToSprintId: null });
    expect(snaps.wip).toMatchObject({ statusAtClose: "InProgress", carriedToSprintId: s2!.id });
    expect(db.sprint!.find((s) => s.id === s1!.id)).toMatchObject({
      plannedCount: 5,
      completedCount: 1,
      carriedOverCount: 3,
    });
  });

  it("does not close the sprint on its own last day (lab time)", async () => {
    // 2026-09-22 23:30 ET is already 09-23 in UTC.
    expect(await closeEndedSprints("p1", new Date("2026-09-23T03:30:00Z"))).toEqual([]);
  });

  it("is a no-op on a second tick", async () => {
    const [s1] = sprintsOf();
    db.task = [task("todo", { sprintId: s1!.id })];
    await closeEndedSprints("p1", at("2026-09-23"));
    expect(await closeEndedSprints("p1", at("2026-09-23"))).toEqual([]);
    expect(db.task![0]!.carryoverCount).toBe(1);
  });

  it("closes several missed sprints in order, carrying work forward each time", async () => {
    const [s1, , , s4] = sprintsOf();
    db.task = [task("todo", { sprintId: s1!.id })];
    const closed = await closeEndedSprints("p1", at("2026-10-07"));
    expect(closed.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(db.task![0]).toMatchObject({ sprintId: s4!.id, carryoverCount: 3 });
    expect(db.sprintTaskSnapshot!.map((x) => x.carriedToSprintId)).toEqual(
      sprintsOf().slice(1, 4).map((x) => x.id),
    );
  });

  it("keeps unfinished work in a term's final sprint", async () => {
    const last = sprintsOf().at(-1)!;
    db.task = [task("todo", { sprintId: last.id })];
    const closed = await closeEndedSprints("p1", at("2026-11-26"));
    expect(closed.at(-1)).toMatchObject({ id: last.id, carried: 0, nextSprintId: null });
    expect(db.task![0]).toMatchObject({ sprintId: last.id, carryoverCount: 0 });
    expect(db.sprintTaskSnapshot!.find((s) => s.taskId === "todo")).toMatchObject({
      statusAtClose: "Todo",
      carriedToSprintId: null,
    });
  });
});

describe("setSprintAnchor", () => {
  it("rebuilds only upcoming sprints and remaps their tasks by overlap", async () => {
    await ensureSprints("p1", at("2026-10-12")); // Wednesday sprints; Sprint 4 = 10-07..10-13 active
    const before = sprintsOf();
    const active = before[3]!;
    const s6 = before[5]!; // 10-21..10-27
    db.task = [task("planned", { sprintId: s6.id }), task("now", { sprintId: active.id })];

    await setSprintAnchor("p1", "26F", 1, at("2026-10-12"));

    const after = sprintsOf();
    expect(after.slice(0, 4).map((s) => s.id)).toEqual(before.slice(0, 4).map((s) => s.id));
    // The active sprint absorbs the gap up to the first Monday.
    expect(fmt(after[3]!.endsOn)).toBe("2026-10-18");
    expect(fmt(after[4]!.startsOn)).toBe("2026-10-19");
    expect(after.slice(4).every((s) => s.startsOn.getUTCDay() === 1)).toBe(true);
    expect(after.map((s) => s.number)).toEqual(after.map((_, i) => i + 1));
    for (let i = 1; i < after.length; i++) {
      expect(after[i]!.startsOn.getTime()).toBe(after[i - 1]!.endsOn.getTime() + 86_400_000);
    }
    expect(fmt(after.at(-1)!.endsOn)).toBe("2026-11-24");

    const byId = Object.fromEntries(db.task!.map((t) => [t.id, t]));
    expect(byId.now!.sprintId).toBe(active.id);
    // Old Wed 10-21..Tue 10-27 overlaps Mon 10-19..Sun 10-25 for 5 days.
    expect(fmt(after.find((s) => s.id === byId.planned!.sprintId)!.startsOn)).toBe("2026-10-19");
    expect(db.projectTerm!.find((pt) => pt.termId === "26F")!.sprintAnchorDay).toBe(1);
  });

  it("rebuilds the whole term before it starts", async () => {
    await ensureSprints("p1", at("2026-09-01"));
    await setSprintAnchor("p1", "26F", 1, at("2026-09-01"));
    const after = sprintsOf();
    expect(fmt(after[0]!.startsOn)).toBe("2026-09-21");
    expect(after[0]!.number).toBe(1);
  });

  it("rejects an out-of-range weekday", async () => {
    await expect(setSprintAnchor("p1", "26F", 7)).rejects.toThrow();
  });
});

describe("getOrCreateGeneralEpic", () => {
  it("creates General once, after existing epics", async () => {
    const id = await getOrCreateGeneralEpic("p1");
    expect(await getOrCreateGeneralEpic("p1")).toBe(id);
    expect(db.epic!.filter((e) => e.title === "General")).toHaveLength(1);
    expect(db.epic!.find((e) => e.id === id)!.position).toBe(1);
  });
});

describe("backfillProjectTasks", () => {
  beforeEach(async () => {
    await ensureSprints("p1", at("2026-10-12")); // Sprint 4 active
    db.project![0]!.sprintsBackfilledAt = null;
    db.userStory = [{ id: "st1", epicId: "e1" }];
  });

  it("maps legacy tasks onto sprints, General, and Todo", async () => {
    const s = sprintsOf();
    db.task = [
      task("undated", { status: "Backlog", epicId: null }),
      task("future", { dueAt: day("2026-10-30") }),
      task("startOnly", { startsAt: day("2026-10-08") }),
      task("staleOpen", { dueAt: day("2026-09-20"), status: "InProgress" }),
      task("pastDone", { dueAt: day("2026-09-20"), status: "Done" }),
      task("storyOnly", { epicId: null, storyId: "st1" }),
      task("oldTermDone", { dueAt: day("2026-07-01"), status: "Done", epicId: null }),
    ];
    await backfillProjectTasks("p1", at("2026-10-12"));
    const byId = Object.fromEntries(db.task!.map((t) => [t.id, t]));
    const general = db.epic!.find((e) => e.title === "General")!.id;

    expect(byId.undated).toMatchObject({ sprintId: null, status: "Todo", epicId: general });
    expect(byId.future!.sprintId).toBe(s[6]!.id); // 10-28..11-03
    expect(byId.startOnly!.sprintId).toBe(s[3]!.id);
    expect(byId.staleOpen).toMatchObject({ sprintId: s[3]!.id, carryoverCount: 1 });
    expect(byId.pastDone!.sprintId).toBe(s[0]!.id);
    expect(byId.storyOnly!.epicId).toBe("e1");
    expect(byId.oldTermDone).toMatchObject({ sprintId: null, epicId: general });
    expect(db.project![0]!.sprintsBackfilledAt).not.toBeNull();
  });

  it("snapshots already-ended sprints without re-rolling backfilled work", async () => {
    const s = sprintsOf();
    db.task = [task("pastDone", { dueAt: day("2026-09-20"), status: "Done" })];
    await backfillProjectTasks("p1", at("2026-10-12"));
    expect(s.slice(0, 3).every((x) => db.sprint!.find((y) => y.id === x.id)!.closedAt)).toBe(true);
    expect(db.sprint!.find((x) => x.id === s[0]!.id)).toMatchObject({ plannedCount: 1, completedCount: 1 });
    expect(db.sprint!.find((x) => x.id === s[3]!.id)!.closedAt).toBeNull();
  });

  it("runs once", async () => {
    db.task = [task("future", { dueAt: day("2026-10-30") })];
    await backfillProjectTasks("p1", at("2026-10-12"));
    db.task![0]!.sprintId = null;
    await backfillProjectTasks("p1", at("2026-10-12"));
    expect(db.task![0]!.sprintId).toBeNull();
  });
});
