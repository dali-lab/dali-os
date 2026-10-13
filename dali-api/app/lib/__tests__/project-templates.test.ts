import { describe, it, expect, vi, beforeEach } from "vitest";

// A minimal prisma stub. $transaction invokes its callback with a `tx` whose
// create methods hand back sequential ids and record their args.

const prismaMock = vi.hoisted(() => ({
  epic: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
  sprint: { findMany: vi.fn() },
  project: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  projectTemplate: { findUnique: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));
const sprintsMock = vi.hoisted(() => ({
  ensureSprints: vi.fn(),
  getOrCreateGeneralEpic: vi.fn(async () => "general"),
}));

vi.mock("~/lib/db", () => ({ prisma: prismaMock }));
vi.mock("~/lib/groups", () => ({ ensureProjectGroup: vi.fn() }));
vi.mock("~/lib/page-copy.server", () => ({ duplicatePage: vi.fn() }));
vi.mock("~/projects/lib/sprints.server", () => sprintsMock);

import {
  captureProjectBlueprint,
  instantiateProjectTemplate,
  PROJECT_BLUEPRINT_VERSION,
  type ProjectBlueprint,
} from "../project-templates.server";

const task = (extra: Record<string, unknown>) => ({
  id: "t",
  title: "Task",
  description: null,
  status: "Todo",
  priority: "Normal",
  checklist: null,
  epicId: null,
  domainId: null,
  sprintId: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.sprint.findMany.mockResolvedValue([]);
});

describe("captureProjectBlueprint", () => {
  it("assigns epic refs, remaps task links, and records sprint offsets", async () => {
    prismaMock.epic.findMany.mockResolvedValue([
      { id: "epicA", title: "A", description: "da", stories: [] },
    ]);
    prismaMock.sprint.findMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }]);
    prismaMock.task.findMany.mockResolvedValue([
      task({ id: "t1", checklist: [{ text: "x", done: false }], epicId: "epicA", domainId: "d1", sprintId: "s3" }),
      task({ id: "t2" }),
    ]);

    const bp = await captureProjectBlueprint("proj");

    expect(bp.version).toBe(PROJECT_BLUEPRINT_VERSION);
    expect(bp.epics[0]).toEqual({ ref: "e0", title: "A", description: "da", stories: [] });
    expect(bp.tasks[0]).toMatchObject({ epicRef: "e0", domainId: "d1", sprintOffset: 2 });
    expect(bp.tasks[0].checklist).toEqual([{ text: "x", done: false }]);
    expect(bp.tasks[1]).toMatchObject({ epicRef: null, sprintOffset: null });
  });
});

describe("instantiateProjectTemplate", () => {
  function setup(blueprint: ProjectBlueprint, newSprints: { id: string }[]) {
    prismaMock.projectTemplate.findUnique.mockResolvedValue({
      id: "tpl",
      blueprint,
      iconEmoji: "🚀",
      overviewSourcePageId: null,
    });
    prismaMock.project.create.mockResolvedValue({ id: "newProj", name: "New" });
    prismaMock.sprint.findMany.mockResolvedValue(newSprints);
    const created: { epic: any[]; task: any[] } = { epic: [], task: [] };
    const tx = {
      epic: {
        create: vi.fn(async ({ data }: any) => {
          created.epic.push(data);
          return { id: `epic_${created.epic.length}` };
        }),
      },
      task: {
        create: vi.fn(async ({ data }: any) => {
          created.task.push(data);
          return { id: `task_${created.task.length}` };
        }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx));
    return created;
  }

  const bpTask = (extra: Partial<ProjectBlueprint["tasks"][number]>) => ({
    title: "T",
    description: null,
    status: "Todo" as const,
    priority: "High" as const,
    checklist: null,
    epicRef: "e0",
    domainId: null,
    ...extra,
  });

  it("rebuilds epics and tasks, re-applying sprint offsets to the new sprints", async () => {
    const created = setup(
      {
        version: 2,
        epics: [{ ref: "e0", title: "Epic", description: null, stories: [] }],
        tasks: [
          bpTask({ checklist: [{ text: "c", done: true }], sprintOffset: 1 }),
          bpTask({ sprintOffset: 9 }),
          bpTask({ sprintOffset: null }),
        ],
      },
      [{ id: "n1" }, { id: "n2" }],
    );

    const res = await instantiateProjectTemplate({ templateId: "tpl", name: "New", createdBy: "u1" });

    expect(res.id).toBe("newProj");
    expect(sprintsMock.ensureSprints).toHaveBeenCalledWith("newProj");
    expect(created.epic[0]).not.toHaveProperty("status");
    expect(created.task.map((t) => t.sprintId)).toEqual(["n2", null, null]);
    expect(created.task[0]).toMatchObject({ epicId: "epic_1", createdById: "u1", position: 0 });
    expect(created.task[0].checklist).toEqual([{ text: "c", done: true }]);
    // Positions count per (sprint, status) column.
    expect(created.task.map((t) => t.position)).toEqual([0, 0, 1]);
  });

  it("reads v1 blueprints: backlog, Backlog status → Todo, epic-less → General", async () => {
    const created = setup(
      {
        version: 1,
        epics: [],
        tasks: [bpTask({ status: "Backlog", epicRef: null })],
      },
      [{ id: "n1" }],
    );
    await instantiateProjectTemplate({ templateId: "tpl", name: "New", createdBy: "u1" });
    expect(created.task[0]).toMatchObject({ status: "Todo", sprintId: null, epicId: "general" });
  });
});
