import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  project: { findFirst: vi.fn(), create: vi.fn() },
  task: { findMany: vi.fn() },
  taskView: { findMany: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
const refs = vi.hoisted(() => ({ domains: vi.fn(), members: vi.fn() }));
vi.mock("~/lib/reference-cache.server", () => ({
  activeDomainOptions: refs.domains,
}));
vi.mock("~/lib/core-members.server", () => ({
  listActiveCoreMembers: refs.members,
}));

import { loadCoreTaskboard } from "~/core/lib/taskboard.server";

const CORE = { id: "core1", name: "Core" };

beforeEach(() => {
  vi.resetAllMocks();
  refs.domains.mockResolvedValue([{ id: "d1", displayName: "Design" }]);
  refs.members.mockResolvedValue([{ userId: "u1", name: "Ada Lovelace" }]);
});

describe("loadCoreTaskboard", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    title: "Plan retreat",
    description: null,
    status: "Todo",
    priority: "Normal",
    position: 0,
    dueAt: null,
    startsAt: null,
    epicId: null,
    storyId: null,
    checklist: null,
    githubIssueNumber: null,
    githubIssueUrl: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    activityAt: new Date("2026-11-03T00:00:00Z"),
    createdBy: { id: "u1", firstName: "Ada", lastName: "Lovelace" },
    domain: null,
    assignees: [{ user: { id: "u1", firstName: "Ada", lastName: "Lovelace" } }],
    files: [],
    _count: { comments: 2 },
    dependencies: [],
    ...over,
  });

  it("loads only the Core project's live tasks and maps them to cards", async () => {
    db.project.findFirst.mockResolvedValue(CORE);
    db.task.findMany.mockResolvedValue([row()]);
    db.taskView.findMany.mockResolvedValue([{ taskId: "t1", viewedAt: new Date("2026-11-02T00:00:00Z") }]);

    const out = await loadCoreTaskboard("u2", new Request("http://x/core"));

    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "core1", archivedAt: null } }),
    );
    expect(out.projectId).toBe("core1");
    expect(out.tasks[0]).toMatchObject({
      id: "t1",
      commentCount: 2,
      assignees: [{ id: "u1", name: "Ada Lovelace" }],
      hasUnread: true,
    });
    expect(out.options.members).toEqual([{ id: "u1", name: "Ada Lovelace", photoUrl: null, domainId: null }]);
    expect(out.options.domains).toEqual([{ id: "d1", name: "Design" }]);
    expect(out.options.epics).toEqual([]);
  });

  it("skips the views lookup on an empty board", async () => {
    db.project.findFirst.mockResolvedValue(CORE);
    db.task.findMany.mockResolvedValue([]);
    const out = await loadCoreTaskboard("u2", new Request("http://x/core"));
    expect(out.tasks).toEqual([]);
    expect(db.taskView.findMany).not.toHaveBeenCalled();
  });
});
