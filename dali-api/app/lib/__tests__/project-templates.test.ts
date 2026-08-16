import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// A minimal prisma stub. Query/write methods are per-test vi.fns; $transaction
// invokes its callback with a `tx` whose create methods hand back sequential ids
// and record their args so we can assert remapping/rebasing.

const prismaMock = vi.hoisted(() => ({
  epic: { findMany: vi.fn() },
  sprint: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
  project: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  projectTemplate: { findUnique: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("~/lib/db", () => ({ prisma: prismaMock }));
vi.mock("~/lib/groups", () => ({ ensureProjectGroup: vi.fn() }));
vi.mock("~/lib/page-copy.server", () => ({ duplicatePage: vi.fn() }));

import {
  captureProjectBlueprint,
  instantiateProjectTemplate,
  type ProjectBlueprint,
} from "../project-templates.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("captureProjectBlueprint", () => {
  it("assigns refs, rebases sprint dates to day-offsets, and remaps task links", async () => {
    prismaMock.epic.findMany.mockResolvedValue([
      { id: "epicA", title: "A", description: "da", status: "Open", stories: [] },
    ]);
    prismaMock.sprint.findMany.mockResolvedValue([
      { id: "s1", name: "Sprint 1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-15"), epicId: "epicA", status: "Planned" },
      { id: "s2", name: "Sprint 2", startsAt: new Date("2026-01-15"), endsAt: new Date("2026-01-29"), epicId: null, status: "Planned" },
    ]);
    prismaMock.task.findMany.mockResolvedValue([
      { id: "t1", title: "Task", description: null, status: "Todo", priority: "Normal", checklist: [{ text: "x", done: false }], epicId: "epicA", sprintId: "s2", domainId: "d1" },
    ]);

    const bp = await captureProjectBlueprint("proj");

    expect(bp.epics[0].ref).toBe("e0");
    // Anchor is the earliest sprint start; offsets are whole days from it.
    expect(bp.sprints[0]).toMatchObject({ ref: "s0", startOffsetDays: 0, endOffsetDays: 14, epicRef: "e0" });
    expect(bp.sprints[1]).toMatchObject({ ref: "s1", startOffsetDays: 14, endOffsetDays: 28, epicRef: null });
    // Task links remap to blueprint refs, checklist carries verbatim.
    expect(bp.tasks[0]).toMatchObject({ epicRef: "e0", sprintRef: "s1", domainId: "d1" });
    expect(bp.tasks[0].checklist).toEqual([{ text: "x", done: false }]);
  });
});

describe("instantiateProjectTemplate", () => {
  it("rebuilds epics/sprints/tasks, remapping refs and rebasing dates onto startDate", async () => {
    const blueprint: ProjectBlueprint = {
      version: 1,
      epics: [{ ref: "e0", title: "Epic", description: null, status: "Open", stories: [] }],
      sprints: [{ ref: "s0", name: "Sprint 1", startOffsetDays: 0, endOffsetDays: 7, epicRef: "e0", status: "Planned" }],
      tasks: [{ title: "T", description: null, status: "Todo", priority: "High", checklist: [{ text: "c", done: true }], epicRef: "e0", sprintRef: "s0", domainId: null }],
    };
    prismaMock.projectTemplate.findUnique.mockResolvedValue({ id: "tpl", blueprint, iconEmoji: "🚀", overviewSourcePageId: null });
    prismaMock.project.create.mockResolvedValue({ id: "newProj", name: "New" });

    // tx stub: create methods return sequential ids and record args.
    const created: { epic: any[]; sprint: any[]; task: any[] } = { epic: [], sprint: [], task: [] };
    const tx = {
      epic: { create: vi.fn(async ({ data }: any) => { created.epic.push(data); return { id: `epic_${created.epic.length}` }; }) },
      sprint: { create: vi.fn(async ({ data }: any) => { created.sprint.push(data); return { id: `sprint_${created.sprint.length}` }; }) },
      task: { create: vi.fn(async ({ data }: any) => { created.task.push(data); return { id: `task_${created.task.length}` }; }) },
    };
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx));

    const start = new Date("2026-03-01T00:00:00Z");
    const res = await instantiateProjectTemplate({ templateId: "tpl", name: "New", createdBy: "u1", startDate: start });

    expect(res.id).toBe("newProj");
    // Epic created first; sprint points at the freshly-created epic id.
    expect(created.epic).toHaveLength(1);
    expect(created.sprint[0].epicId).toBe("epic_1");
    // Sprint dates rebased onto startDate.
    expect(created.sprint[0].startsAt.getTime()).toBe(start.getTime());
    expect(created.sprint[0].endsAt.getTime()).toBe(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    // Task remaps to the created epic + sprint ids; checklist carries verbatim.
    expect(created.task[0]).toMatchObject({ epicId: "epic_1", sprintId: "sprint_1", createdById: "u1" });
    expect(created.task[0].checklist).toEqual([{ text: "c", done: true }]);
  });
});
