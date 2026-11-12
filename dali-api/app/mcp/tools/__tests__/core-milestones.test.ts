import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  isCore: vi.fn(),
  currentTerm: vi.fn(),
  termFindUnique: vi.fn(),
  getTermMilestones: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  moveMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  fillTermFromLastYear: vi.fn(),
}));
vi.mock("~/lib/db.server", () => ({ prisma: { term: { findUnique: m.termFindUnique } } }));
vi.mock("~/lib/roles", () => ({ isCore: m.isCore, currentTerm: m.currentTerm }));
vi.mock("~/core/lib/milestones.server", () => ({
  MilestoneError: class MilestoneError extends Error {
    status = 400;
  },
  getTermMilestones: m.getTermMilestones,
  createMilestone: m.createMilestone,
  updateMilestone: m.updateMilestone,
  moveMilestone: m.moveMilestone,
  deleteMilestone: m.deleteMilestone,
  fillTermFromLastYear: m.fillTermFromLastYear,
}));

import {
  CORE_MILESTONE_TOOLS,
  LIST_CORE_MILESTONES_TOOL,
  MANAGE_CORE_MILESTONE_TOOL,
  runListCoreMilestones,
  runManageCoreMilestone,
} from "../core-milestones";
import { REGISTRY_TOOLS } from "~/mcp/registry";

const ctx = { user: { id: "u1" }, scopes: [], request: new Request("http://x") } as never;

beforeEach(() => {
  vi.resetAllMocks();
  m.isCore.mockResolvedValue(true);
});

describe("registration and scopes", () => {
  it("registers both tools with the right scopes", () => {
    expect(LIST_CORE_MILESTONES_TOOL.requiredScope).toBe("mcp:read");
    expect(MANAGE_CORE_MILESTONE_TOOL.requiredScope).toBe("mcp:write");
    const names = REGISTRY_TOOLS.map((t) => t.def.name);
    expect(names).toContain("list_core_milestones");
    expect(names).toContain("manage_core_milestone");
    expect(CORE_MILESTONE_TOOLS).toHaveLength(2);
  });
});

describe("access", () => {
  it("rejects non-Core callers on both tools", async () => {
    m.isCore.mockResolvedValue(false);
    await expect(runListCoreMilestones(ctx, {})).rejects.toMatchObject({ status: 403 });
    await expect(runManageCoreMilestone(ctx, { action: "delete", id: "a" })).rejects.toMatchObject({ status: 403 });
    expect(m.deleteMilestone).not.toHaveBeenCalled();
  });
});

describe("list_core_milestones", () => {
  const items = [
    { id: "a", week: 1, kind: "Milestone", title: "Goal", notes: null, position: 0, owners: [] },
    { id: "b", week: 1, kind: "Plan", title: "Do", notes: null, position: 0, owners: [] },
  ];

  it("defaults to the current term and groups all 11 weeks", async () => {
    m.currentTerm.mockResolvedValue({ id: "t1", code: "26F" });
    m.getTermMilestones.mockResolvedValue({ items });
    const out = (await runListCoreMilestones(ctx, {})) as any;
    expect(out.termCode).toBe("26F");
    expect(out.weeks).toHaveLength(11);
    expect(out.weeks[1].items.map((i: any) => i.id)).toEqual(["a", "b"]);
  });

  it("filters by kind and resolves a term code", async () => {
    m.termFindUnique.mockResolvedValue({ id: "t2", code: "26X" });
    m.getTermMilestones.mockResolvedValue({ items });
    const out = (await runListCoreMilestones(ctx, { termCode: "26x", kind: "Plan" })) as any;
    expect(m.termFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "26X" } }));
    expect(out.weeks[1].items.map((i: any) => i.id)).toEqual(["b"]);
  });

  it("rejects an unknown term and a bad kind", async () => {
    m.termFindUnique.mockResolvedValue(null);
    await expect(runListCoreMilestones(ctx, { termCode: "99Z" })).rejects.toMatchObject({ status: 404 });
    await expect(runListCoreMilestones(ctx, { kind: "Task" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("manage_core_milestone", () => {
  it("requires the fields each action needs", async () => {
    await expect(runManageCoreMilestone(ctx, { action: "create", termId: "t1" })).rejects.toMatchObject({ status: 400 });
    await expect(runManageCoreMilestone(ctx, { action: "move", id: "a" })).rejects.toMatchObject({ status: 400 });
    await expect(runManageCoreMilestone(ctx, { action: "bogus" })).rejects.toMatchObject({ status: 400 });
  });

  it("dispatches each action to the shared server functions", async () => {
    m.createMilestone.mockResolvedValue({ id: "n" });
    await runManageCoreMilestone(ctx, { action: "create", termId: "t1", week: 2, title: "x", kind: "Plan", ownerIds: ["o"] });
    expect(m.createMilestone).toHaveBeenCalledWith(
      expect.objectContaining({ termId: "t1", week: 2, kind: "Plan", title: "x", ownerIds: ["o"] }),
      expect.objectContaining({ userId: "u1" }),
    );
    await runManageCoreMilestone(ctx, { action: "update", id: "a", title: "y" });
    expect(m.updateMilestone).toHaveBeenCalledWith(expect.objectContaining({ id: "a", title: "y" }), expect.anything());
    await runManageCoreMilestone(ctx, { action: "move", id: "a", toWeek: 4, toPosition: 0 });
    expect(m.moveMilestone).toHaveBeenCalledWith({ id: "a", toWeek: 4, toPosition: 0 }, expect.anything());
    await runManageCoreMilestone(ctx, { action: "delete", id: "a" });
    expect(m.deleteMilestone).toHaveBeenCalledWith("a", expect.anything());
    await runManageCoreMilestone(ctx, { action: "fill_from_last_year", termId: "t1" });
    expect(m.fillTermFromLastYear).toHaveBeenCalledWith("t1", expect.anything());
  });

  it("maps a domain error to an invalid-params error", async () => {
    const { MilestoneError } = await import("~/core/lib/milestones.server");
    m.createMilestone.mockRejectedValue(new MilestoneError("Week must be between 0 and 10"));
    await expect(
      runManageCoreMilestone(ctx, { action: "create", termId: "t1", week: 11, title: "x" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("core milestone tool flag", () => {
  it("gates every registry entry on core-taskboard", () => {
    expect(CORE_MILESTONE_TOOLS.map((t) => t.featureFlag)).toEqual(["core-taskboard", "core-taskboard"]);
  });
});
