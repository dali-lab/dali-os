import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  class MilestoneError extends Error {
    constructor(
      message: string,
      public status: 400 | 404 = 400,
    ) {
      super(message);
    }
  }
  return {
    MilestoneError,
    requireAuth: vi.fn(),
    isCore: vi.fn(),
    getUserRoles: vi.fn(),
    isFeatureEnabled: vi.fn(),
    loadMilestonesPage: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    moveMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    fillTermFromLastYear: vi.fn(),
  };
});
vi.mock("~/lib/auth", () => ({ requireAuth: m.requireAuth }));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: () => new Response(null, { status: 302, headers: { Location: "/login" } }),
}));
vi.mock("~/lib/roles", () => ({ isCore: m.isCore, getUserRoles: m.getUserRoles }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: m.isFeatureEnabled }));
vi.mock("~/core/lib/milestones-page.server", () => ({ loadMilestonesPage: m.loadMilestonesPage }));
vi.mock("~/core/lib/milestones.server", () => ({
  MilestoneError: m.MilestoneError,
  createMilestone: m.createMilestone,
  updateMilestone: m.updateMilestone,
  moveMilestone: m.moveMilestone,
  deleteMilestone: m.deleteMilestone,
  fillTermFromLastYear: m.fillTermFromLastYear,
}));
vi.mock("~/core/components/milestones/MilestonesPage", () => ({ MilestonesPage: () => null }));

import { action, loader } from "~/core/routes/core.milestones";

const location = (r: Response) => r.headers.get("Location");
const runLoader = (url = "http://x/core/milestones") => loader({ request: new Request(url) } as never) as Promise<any>;
const runAction = (fields: Record<string, string | string[]>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) (Array.isArray(v) ? v : [v]).forEach((x) => body.append(k, x));
  return action({ request: new Request("http://x/core/milestones", { method: "POST", body }) } as never) as Promise<any>;
};

beforeEach(() => {
  vi.resetAllMocks();
  m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  m.isCore.mockResolvedValue(true);
  m.getUserRoles.mockResolvedValue({ isCore: true, isAdmin: false });
  m.isFeatureEnabled.mockResolvedValue(true);
});

describe("milestones loader", () => {
  it("sends non-Core members home without loading anything", async () => {
    m.isCore.mockResolvedValue(false);
    expect(location(await runLoader())).toBe("/");
    expect(m.loadMilestonesPage).not.toHaveBeenCalled();
  });

  it("redirects Core to Staffing while the flag is off, keeping embed", async () => {
    m.isFeatureEnabled.mockResolvedValue(false);
    expect(location(await runLoader())).toBe("/core/staffing");
    expect(location(await runLoader("http://x/core/milestones?embed=1"))).toBe("/core/staffing?embed=1");
    expect(m.loadMilestonesPage).not.toHaveBeenCalled();
  });

  it("sends signed-out visitors to login", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    expect(location(await runLoader())).toBe("/login");
  });

  it("loads the page for Core with the flag on", async () => {
    m.loadMilestonesPage.mockResolvedValue({ term: null });
    expect(await runLoader()).toEqual({ term: null, isAdmin: false });
  });
});

describe("milestones action", () => {
  it("rejects non-Core callers for every intent", async () => {
    m.isCore.mockResolvedValue(false);
    for (const intent of ["create", "update", "move", "delete", "fill"]) {
      const res = await runAction({ intent, id: "x", termId: "t", week: "1", title: "a", toWeek: "2" });
      expect(location(res)).toBe("/");
    }
    expect(m.createMilestone).not.toHaveBeenCalled();
    expect(m.deleteMilestone).not.toHaveBeenCalled();
  });

  it("is blocked while the flag is off", async () => {
    m.isFeatureEnabled.mockResolvedValue(false);
    expect(location(await runAction({ intent: "delete", id: "x" }))).toBe("/core/staffing");
    expect(m.deleteMilestone).not.toHaveBeenCalled();
  });

  it("creates with the parsed fields", async () => {
    expect(await runAction({ intent: "create", termId: "t1", week: "3", kind: "Plan", title: "Open hiring" })).toEqual({ ok: true });
    expect(m.createMilestone).toHaveBeenCalledWith(
      expect.objectContaining({ termId: "t1", week: 3, kind: "Plan", title: "Open hiring" }),
      expect.objectContaining({ userId: "u1" }),
    );
  });

  it("passes owners, and an empty owner list when ownersTouched is sent alone", async () => {
    await runAction({ intent: "update", id: "a", ownerIds: ["o1", "o2"], ownersTouched: "1" });
    expect(m.updateMilestone).toHaveBeenLastCalledWith(expect.objectContaining({ ownerIds: ["o1", "o2"] }), expect.anything());
    await runAction({ intent: "update", id: "a", ownersTouched: "1" });
    expect(m.updateMilestone).toHaveBeenLastCalledWith(expect.objectContaining({ ownerIds: [] }), expect.anything());
  });

  it("rejects a week outside 0 to 10 and unknown intents", async () => {
    const res = await runAction({ intent: "create", termId: "t1", week: "11", title: "x" });
    expect(res.init.status).toBe(400);
    expect((await runAction({ intent: "nope" })).init.status).toBe(400);
    expect(m.createMilestone).not.toHaveBeenCalled();
  });

  it("returns a domain error as a message with its status", async () => {
    m.moveMilestone.mockRejectedValue(new m.MilestoneError("Milestone not found", 404));
    const res = await runAction({ intent: "move", id: "x", toWeek: "2" });
    expect(res.init.status).toBe(404);
    expect(res.data).toEqual({ error: "Milestone not found" });
  });

  it("dispatches delete, move and fill", async () => {
    await runAction({ intent: "delete", id: "a" });
    await runAction({ intent: "move", id: "a", toWeek: "4", toPosition: "1" });
    await runAction({ intent: "fill", termId: "t1" });
    expect(m.deleteMilestone).toHaveBeenCalledWith("a", expect.anything());
    expect(m.moveMilestone).toHaveBeenCalledWith({ intent: "move", id: "a", toWeek: 4, toPosition: 1 }, expect.anything());
    expect(m.fillTermFromLastYear).toHaveBeenCalledWith("t1", expect.anything());
  });
});
