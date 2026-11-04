import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { activityEvent: { findMany: vi.fn() }, user: { findMany: vi.fn() } },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isCore: vi.fn() }));
vi.mock("~/lib/activities.server", () => ({
  getActivityForMember: vi.fn(),
  listActivityTeams: vi.fn(),
}));
vi.mock("~/activities/mechanics/registry.server", () => ({ mechanicServer: vi.fn() }));
vi.mock("~/lib/activity-events.server", () => ({ publishActivityChange: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { getUserRoles, isCore } from "~/lib/roles";
import { getActivityForMember, listActivityTeams } from "~/lib/activities.server";
import { mechanicServer } from "~/activities/mechanics/registry.server";
import { publishActivityChange } from "~/lib/activity-events.server";
import { loader, action } from "../api.activities.$id";

const m = prisma as any;
const activity = { id: "a1", name: "Hunt", kind: "scavenger", scoring: "Individual" };
const mech = { summarize: vi.fn(), onAction: vi.fn() };

function load() {
  return loader({ request: new Request("http://localhost/api/activities/a1"), params: { id: "a1" }, context: {} } as never);
}
function post(fields: Record<string, string> = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/api/activities/a1", { method: "POST", body }),
    params: { id: "a1" },
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(getUserRoles).mockResolvedValue(["Member"] as never);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(getActivityForMember).mockResolvedValue({ activity, assigned: true, active: true, team: null } as never);
  vi.mocked(mechanicServer).mockReturnValue(mech as never);
  vi.mocked(listActivityTeams).mockResolvedValue([]);
  m.activityEvent.findMany.mockResolvedValue([]);
  m.user.findMany.mockResolvedValue([]);
  mech.summarize.mockReturnValue({ progress: { found: 1 }, results: [] });
  mech.onAction.mockResolvedValue({ ok: true });
});

describe("GET /api/activities/:id", () => {
  it("401s an unauthenticated caller", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = (await load()) as Response;
    expect(res.status).toBe(401);
    expect(getActivityForMember).not.toHaveBeenCalled();
  });

  it("404s an activity the member is not assigned to, and a missing one", async () => {
    vi.mocked(getActivityForMember).mockResolvedValue({ activity, assigned: false, active: true, team: null } as never);
    await expect(load()).rejects.toMatchObject({ status: 404 });
    vi.mocked(getActivityForMember).mockResolvedValue(null as never);
    await expect(load()).rejects.toMatchObject({ status: 404 });
    expect(mech.summarize).not.toHaveBeenCalled();
  });

  it("404s an activity kind with no server mechanic", async () => {
    vi.mocked(mechanicServer).mockReturnValue(null as never);
    await expect(load()).rejects.toMatchObject({ status: 404 });
  });

  it("checks assignment with the caller's id and roles", async () => {
    await load();
    expect(getActivityForMember).toHaveBeenCalledWith("a1", "u1", ["Member"]);
  });

  it("returns progress, results and display names for everyone on the board", async () => {
    const allEvents = [{ userId: "u2" }, { userId: "u2" }, { userId: "u3" }];
    m.activityEvent.findMany.mockImplementation(async (args: any) => (args.where.userId ? [{ userId: "u1" }] : allEvents));
    m.user.findMany.mockResolvedValue([
      { id: "u2", firstName: "Ada", lastName: "Lovelace" },
      { id: "u3", firstName: "Grace", lastName: "Hopper" },
    ]);
    mech.summarize.mockReturnValue({ progress: { found: 3 }, results: [{ rank: 1 }] });
    expect(await load()).toEqual({
      activityId: "a1",
      name: "Hunt",
      kind: "scavenger",
      active: true,
      currentUserId: "u1",
      nameByUserId: { u2: "Ada Lovelace", u3: "Grace Hopper" },
      progress: { found: 3 },
      results: [{ rank: 1 }],
    });
    expect(m.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["u2", "u3"] } } }),
    );
    expect(mech.summarize).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", viewerIsCore: false, userEvents: [{ userId: "u1" }], allEvents, teams: [], viewerTeam: null }),
    );
  });

  it("includes teammates on team-scored activities even if they have no events yet", async () => {
    vi.mocked(getActivityForMember).mockResolvedValue({
      activity: { ...activity, scoring: "Team" },
      assigned: true,
      active: true,
      team: { id: "t1" },
    } as never);
    vi.mocked(listActivityTeams).mockResolvedValue([{ id: "t1", memberIds: ["u4"] }] as never);
    await load();
    expect(listActivityTeams).toHaveBeenCalledWith("a1");
    expect(m.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["u4"] } } }));
  });

  it("skips the user lookup when nobody has scored", async () => {
    await load();
    expect(m.user.findMany).not.toHaveBeenCalled();
    expect(listActivityTeams).not.toHaveBeenCalled();
  });
});

describe("POST /api/activities/:id", () => {
  it("returns the auth response for an unauthenticated caller", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);
    expect((await post()).status).toBe(401);
    expect(mech.onAction).not.toHaveBeenCalled();
  });

  it("404s an unassigned member and never reaches the mechanic", async () => {
    vi.mocked(getActivityForMember).mockResolvedValue({ activity, assigned: false, active: true, team: null } as never);
    expect((await post({ code: "x" })).status).toBe(404);
    expect(mech.onAction).not.toHaveBeenCalled();
  });

  it("400s once the activity has ended", async () => {
    vi.mocked(getActivityForMember).mockResolvedValue({ activity, assigned: true, active: false, team: null } as never);
    const res = await post({ code: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("This activity has ended.");
    expect(mech.onAction).not.toHaveBeenCalled();
  });

  it("400s an unsupported kind", async () => {
    vi.mocked(mechanicServer).mockReturnValue(null as never);
    expect((await post()).status).toBe(400);
  });

  it("forwards the form to the mechanic as the caller, then nudges open surfaces", async () => {
    const res = await post({ code: "abc" });
    expect(res.status).toBe(200);
    expect(mech.onAction).toHaveBeenCalledWith({ activity, userId: "u1", input: { code: "abc" } });
    expect(publishActivityChange).toHaveBeenCalledWith("a1");
  });

  it("returns a rejected outcome as 400 without publishing", async () => {
    mech.onAction.mockResolvedValue({ ok: false, message: "Wrong code" });
    const res = await post({ code: "bad" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, message: "Wrong code" });
    expect(publishActivityChange).not.toHaveBeenCalled();
  });
});
