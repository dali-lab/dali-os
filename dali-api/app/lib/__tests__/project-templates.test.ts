import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// A minimal prisma stub. Query/write methods are per-test vi.fns; $transaction
// invokes its callback with a `tx` whose create methods hand back sequential ids
// and record their args so we can assert remapping.

const prismaMock = vi.hoisted(() => ({
  epic: { findMany: vi.fn() },
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
  it("assigns epic refs and remaps task links (no stored sprints)", async () => {
    prismaMock.epic.findMany.mockResolvedValue([
      { id: "epicA", title: "A", description: "da", status: "Open", stories: [] },
    ]);
    prismaMock.task.findMany.mockResolvedValue([
      { id: "t1", title: "Task", description: null, status: "Todo", priority: "Normal", checklist: [{ text: "x", done: false }], epicId: "epicA", domainId: "d1" },
    ]);

    const bp = await captureProjectBlueprint("proj");

    expect(bp.epics[0].ref).toBe("e0");
    // Sprints are the computed term grid, not captured rows.
    expect(bp).not.toHaveProperty("sprints");
    // Task links remap to blueprint refs, checklist carries verbatim.
    expect(bp.tasks[0]).toMatchObject({ epicRef: "e0", domainId: "d1" });
    expect(bp.tasks[0]).not.toHaveProperty("sprintRef");
    expect(bp.tasks[0].checklist).toEqual([{ text: "x", done: false }]);
  });
});

describe("instantiateProjectTemplate", () => {
  it("rebuilds epics + tasks, remapping refs; tasks land undated", async () => {
    const blueprint: ProjectBlueprint = {
      version: 1,
      epics: [{ ref: "e0", title: "Epic", description: null, status: "Open", stories: [] }],
      tasks: [{ title: "T", description: null, status: "Todo", priority: "High", checklist: [{ text: "c", done: true }], epicRef: "e0", domainId: null }],
    };
    prismaMock.projectTemplate.findUnique.mockResolvedValue({ id: "tpl", blueprint, iconEmoji: "🚀", overviewSourcePageId: null });
    prismaMock.project.create.mockResolvedValue({ id: "newProj", name: "New" });

    // tx stub: create methods return sequential ids and record args.
    const created: { epic: any[]; task: any[] } = { epic: [], task: [] };
    const tx = {
      epic: { create: vi.fn(async ({ data }: any) => { created.epic.push(data); return { id: `epic_${created.epic.length}` }; }) },
      task: { create: vi.fn(async ({ data }: any) => { created.task.push(data); return { id: `task_${created.task.length}` }; }) },
    };
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx));

    const res = await instantiateProjectTemplate({ templateId: "tpl", name: "New", createdBy: "u1" });

    expect(res.id).toBe("newProj");
    expect(created.epic).toHaveLength(1);
    // Task remaps to the created epic id; no sprint assignment (derived from dates).
    expect(created.task[0]).toMatchObject({ epicId: "epic_1", createdById: "u1" });
    expect(created.task[0]).not.toHaveProperty("sprintId");
    expect(created.task[0].checklist).toEqual([{ text: "c", done: true }]);
  });
});
