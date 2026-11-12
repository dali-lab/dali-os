import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, resolveGroupMembers, getActiveCoreCycleTermIds, adminEnv, mech } = vi.hoisted(() => {
  const model = () => ({
    findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
    delete: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(),
  });
  const prismaMock = {
    activity: model(),
    activityParticipant: model(),
    activityTeam: model(),
    activityEvent: model(),
    adminMembership: model(),
    coreAssignment: model(),
    domainLeadAssignment: model(),
    instructorAssignment: model(),
    cycleInterviewer: model(),
    user: model(),
    $transaction: vi.fn(),
  };
  return {
    prismaMock,
    resolveGroupMembers: vi.fn(),
    getActiveCoreCycleTermIds: vi.fn(),
    adminEnv: vi.fn(),
    mech: { current: null as null | Record<string, unknown> },
  };
});

vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));
vi.mock("~/lib/roles", () => ({
  getActiveCoreCycleTermIds,
  getAdminUserIdsFromEnv: adminEnv,
}));
vi.mock("~/lib/groups.server", () => ({ resolveGroupMembers }));
vi.mock("~/activities/mechanics/registry.server", () => ({ mechanicServer: () => mech.current }));
vi.mock("~/lib/layout-cache.server", () => ({
  LAB_SCOPE: "lab",
  cachedForLayout: (_s: string, _k: string, fn: () => unknown) => fn(),
}));

import {
  cloneActivity,
  createActivity,
  deleteActivity,
  getActivityForMember,
  isAssigned,
  listActivitiesForAdmin,
  listActivityTeams,
  resolveActiveActivitiesForUser,
  resolveActivityRoster,
  resolveTeamForMember,
  saveActivityTeams,
  setActivityStatus,
  updateActivity,
} from "../activities.server";

const noRoles = {} as never;
const core = { isCore: true } as never;
const aud = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  audienceEveryone: false,
  audienceRoles: [] as string[],
  assignedGroupId: null as string | null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mech.current = null;
  adminEnv.mockReturnValue([]);
  getActiveCoreCycleTermIds.mockResolvedValue([]);
  resolveGroupMembers.mockResolvedValue([]);
  prismaMock.activityParticipant.findUnique.mockResolvedValue(null);
  prismaMock.activityParticipant.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
});

describe("isAssigned", () => {
  it("is true for an everyone audience without any query", async () => {
    expect(await isAssigned(aud({ audienceEveryone: true }), "ada", noRoles)).toBe(true);
    expect(prismaMock.activityParticipant.findUnique).not.toHaveBeenCalled();
  });

  it("is true when a held role is in the audience", async () => {
    expect(await isAssigned(aud({ audienceRoles: ["isCore"] }), "ada", core)).toBe(true);
    expect(await isAssigned(aud({ audienceRoles: ["isCore"] }), "ada", noRoles)).toBe(false);
  });

  it("is true for an explicit participant, looked up by activity and user", async () => {
    prismaMock.activityParticipant.findUnique.mockResolvedValue({ userId: "ada" });
    expect(await isAssigned(aud(), "ada", noRoles)).toBe(true);
    expect(prismaMock.activityParticipant.findUnique).toHaveBeenCalledWith({
      where: { activityId_userId: { activityId: "a1", userId: "ada" } },
      select: { userId: true },
    });
  });

  it("is true for a member of the assigned group, false for others, and skips groups when none assigned", async () => {
    resolveGroupMembers.mockResolvedValue(["ada"]);
    expect(await isAssigned(aud({ assignedGroupId: "g1" }), "ada", noRoles)).toBe(true);
    expect(await isAssigned(aud({ assignedGroupId: "g1" }), "grace", noRoles)).toBe(false);
    resolveGroupMembers.mockClear();
    expect(await isAssigned(aud(), "ada", noRoles)).toBe(false);
    expect(resolveGroupMembers).not.toHaveBeenCalled();
  });
});

describe("resolveActivityRoster", () => {
  it("lists every lab member for an everyone audience, name-sorted", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u1", firstName: "Ada", lastName: "Lovelace" },
      { id: "u2", firstName: "Grace", lastName: null },
    ]);
    const out = await resolveActivityRoster(aud({ audienceEveryone: true }));
    expect(out).toEqual([
      { id: "u1", name: "Ada Lovelace" },
      { id: "u2", name: "Grace" },
    ]);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { daliMember: { isNot: null } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
  });

  it("returns empty without querying users when the audience resolves to nobody", async () => {
    expect(await resolveActivityRoster(aud())).toEqual([]);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it("unions role members, group members and explicit participants, deduped and lab-member-only", async () => {
    prismaMock.domainLeadAssignment.findMany.mockResolvedValue([{ userId: "u1" }, { userId: "u2" }]);
    resolveGroupMembers.mockResolvedValue(["u2", "u3"]);
    prismaMock.activityParticipant.findMany.mockResolvedValue([{ userId: "u3" }, { userId: "u4" }]);
    await resolveActivityRoster(aud({ audienceRoles: ["isDomainLead"], assignedGroupId: "g1" }));
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.daliMember).toEqual({ isNot: null });
    expect([...where.id.in].sort()).toEqual(["u1", "u2", "u3", "u4"]);
    expect(prismaMock.activityParticipant.findMany).toHaveBeenCalledWith({
      where: { activityId: "a1" },
      select: { userId: true },
    });
  });

  describe("role targets", () => {
    const idsFor = async (roles: string[]) => {
      await resolveActivityRoster(aud({ audienceRoles: roles }));
      const call = prismaMock.user.findMany.mock.calls.at(-1)?.[0];
      return call?.where?.id?.in ? [...call.where.id.in].sort() : [];
    };

    beforeEach(() => {
      prismaMock.adminMembership.findMany.mockResolvedValue([
        { userId: "admin1", isStaff: false },
        { userId: "staff1", isStaff: true },
      ]);
    });

    it("isAdmin takes AdminMembership plus env-listed admins", async () => {
      adminEnv.mockReturnValue(["env1"]);
      expect(await idsFor(["isAdmin"])).toEqual(["admin1", "env1", "staff1"]);
    });

    it("isStaff takes only staff memberships and not env admins", async () => {
      adminEnv.mockReturnValue(["env1"]);
      expect(await idsFor(["isStaff"])).toEqual(["staff1"]);
    });

    it("isCore adds assignments in the active cycle terms, and skips the query with no active cycle", async () => {
      getActiveCoreCycleTermIds.mockResolvedValue(["t1"]);
      prismaMock.coreAssignment.findMany.mockResolvedValue([{ userId: "core1" }]);
      expect(await idsFor(["isCore"])).toEqual(["admin1", "core1", "staff1"]);
      expect(prismaMock.coreAssignment.findMany).toHaveBeenCalledWith({
        where: { termId: { in: ["t1"] } },
        select: { userId: true },
      });
      prismaMock.coreAssignment.findMany.mockClear();
      getActiveCoreCycleTermIds.mockResolvedValue([]);
      expect(await idsFor(["isCore"])).toEqual(["admin1", "staff1"]);
      expect(prismaMock.coreAssignment.findMany).not.toHaveBeenCalled();
    });

    it("maps instructor, interviewer and alumni to their backing tables", async () => {
      prismaMock.instructorAssignment.findMany.mockResolvedValue([{ userId: "i1" }]);
      prismaMock.cycleInterviewer.findMany.mockResolvedValue([{ userId: "v1" }]);
      prismaMock.user.findMany.mockResolvedValueOnce([{ id: "al1" }]);
      expect(await idsFor(["isInstructor", "isInterviewer", "isAlumni"])).toEqual(["al1", "i1", "v1"]);
      expect(prismaMock.user.findMany.mock.calls[0][0]).toEqual({
        where: { membershipStatus: "Alumni" },
        select: { id: true },
      });
      expect(prismaMock.adminMembership.findMany).not.toHaveBeenCalled();
    });

    it("ignores unknown role keys", async () => {
      expect(await resolveActivityRoster(aud({ audienceRoles: ["isBogus"] }))).toEqual([]);
    });
  });
});

describe("listActivityTeams", () => {
  it("returns teams oldest first with member ids", async () => {
    prismaMock.activityTeam.findMany.mockResolvedValue([
      { id: "t1", name: "Red", members: [{ userId: "u1" }, { userId: "u2" }] },
    ]);
    expect(await listActivityTeams("a1")).toEqual([{ id: "t1", name: "Red", memberIds: ["u1", "u2"] }]);
    expect(prismaMock.activityTeam.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activityId: "a1" }, orderBy: { createdAt: "asc" } }),
    );
  });
});

describe("saveActivityTeams", () => {
  const tx = prismaMock;
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    prismaMock.activityTeam.create.mockResolvedValue({ id: "new1" });
  });

  it("deletes stale teams with their team-created participants, but keeps present teams", async () => {
    prismaMock.activityTeam.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    await saveActivityTeams("a1", [{ id: "t1", name: "Red", memberIds: ["u1"] }]);
    expect(prismaMock.activityParticipant.deleteMany).toHaveBeenCalledWith({
      where: { activityId: "a1", teamId: { in: ["t2"] } },
    });
    expect(prismaMock.activityTeam.deleteMany).toHaveBeenCalledWith({
      where: { activityId: "a1", id: { in: ["t2"] } },
    });
  });

  it("drops empty teams, treating them as removed", async () => {
    prismaMock.activityTeam.findMany.mockResolvedValue([{ id: "t1" }]);
    await saveActivityTeams("a1", [
      { id: "t1", name: "Empty", memberIds: [] },
      { id: "tmp", name: "Also empty", memberIds: [] },
    ]);
    expect(prismaMock.activityTeam.deleteMany).toHaveBeenCalledWith({
      where: { activityId: "a1", id: { in: ["t1"] } },
    });
    expect(prismaMock.activityTeam.create).not.toHaveBeenCalled();
    expect(prismaMock.activityParticipant.upsert).not.toHaveBeenCalled();
  });

  it("never trusts client ids: unknown ids create a fresh team and members point at the real id", async () => {
    prismaMock.activityTeam.findMany.mockResolvedValue([]);
    await saveActivityTeams("a1", [{ id: "client-made-up", name: "Blue", memberIds: ["u1", "u2"] }]);
    expect(prismaMock.activityTeam.create).toHaveBeenCalledWith({
      data: { activityId: "a1", name: "Blue" },
      select: { id: true },
    });
    expect(prismaMock.activityTeam.update).not.toHaveBeenCalled();
    expect(prismaMock.activityParticipant.upsert.mock.calls.map((c) => c[0])).toEqual([
      {
        where: { activityId_userId: { activityId: "a1", userId: "u1" } },
        create: { activityId: "a1", userId: "u1", teamId: "new1" },
        update: { teamId: "new1" },
      },
      expect.objectContaining({ create: { activityId: "a1", userId: "u2", teamId: "new1" } }),
    ]);
  });

  it("renames existing teams, trims and caps names at 120, and defaults blank names to Team", async () => {
    prismaMock.activityTeam.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    await saveActivityTeams("a1", [
      { id: "t1", name: `  ${"x".repeat(200)}  `, memberIds: ["u1"] },
      { id: "t2", name: "   ", memberIds: ["u2"] },
    ]);
    expect(prismaMock.activityTeam.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { name: "x".repeat(120) } });
    expect(prismaMock.activityTeam.update).toHaveBeenCalledWith({ where: { id: "t2" }, data: { name: "Team" } });
  });

  it("puts a member named on two teams on the last one", async () => {
    prismaMock.activityTeam.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    await saveActivityTeams("a1", [
      { id: "t1", name: "A", memberIds: ["u1"] },
      { id: "t2", name: "B", memberIds: ["u1"] },
    ]);
    expect(prismaMock.activityParticipant.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.activityParticipant.upsert.mock.calls[0][0].update).toEqual({ teamId: "t2" });
  });

  it("removes only team-created participants no longer on any team", async () => {
    prismaMock.activityTeam.findMany.mockResolvedValue([{ id: "t1" }]);
    await saveActivityTeams("a1", [{ id: "t1", name: "A", memberIds: ["u1", "u2"] }]);
    expect(prismaMock.activityParticipant.deleteMany).toHaveBeenCalledWith({
      where: { activityId: "a1", teamId: { not: null }, userId: { notIn: ["u1", "u2"] } },
    });
  });

  it("with every team removed, clears all team-created participants", async () => {
    prismaMock.activityTeam.findMany.mockResolvedValue([{ id: "t1" }]);
    await saveActivityTeams("a1", []);
    expect(prismaMock.activityParticipant.deleteMany).toHaveBeenLastCalledWith({
      where: { activityId: "a1", teamId: { not: null } },
    });
  });
});

describe("resolveTeamForMember", () => {
  it("is null for Individual activities without querying", async () => {
    expect(await resolveTeamForMember({ id: "a1", scoring: "Individual" }, "ada")).toBeNull();
    expect(prismaMock.activityParticipant.findUnique).not.toHaveBeenCalled();
  });

  it("is null when the member has no team or the team is gone", async () => {
    const act = { id: "a1", scoring: "Team" } as never;
    prismaMock.activityParticipant.findUnique.mockResolvedValue({ teamId: null });
    expect(await resolveTeamForMember(act, "ada")).toBeNull();
    prismaMock.activityParticipant.findUnique.mockResolvedValue({ teamId: "t9" });
    prismaMock.activityTeam.findUnique.mockResolvedValue(null);
    expect(await resolveTeamForMember(act, "ada")).toBeNull();
  });

  it("returns the team with member ids", async () => {
    prismaMock.activityParticipant.findUnique.mockResolvedValue({ teamId: "t1" });
    prismaMock.activityTeam.findUnique.mockResolvedValue({ id: "t1", name: "Red", members: [{ userId: "ada" }, { userId: "grace" }] });
    expect(await resolveTeamForMember({ id: "a1", scoring: "Team" } as never, "ada")).toEqual({
      id: "t1", name: "Red", memberIds: ["ada", "grace"],
    });
  });
});

describe("resolveActiveActivitiesForUser", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  const row = (over: Record<string, unknown> = {}) => ({
    id: "a1",
    kind: "scavenger_hunt",
    name: "Hunt",
    startsAt: new Date("2026-09-10T00:00:00Z"),
    endsAt: new Date("2026-09-20T00:00:00Z"),
    scoring: "Individual",
    audienceEveryone: true,
    audienceRoles: [],
    assignedGroupId: null,
    ...over,
  });

  it("skips activities the member is not assigned to", async () => {
    prismaMock.activity.findMany.mockResolvedValue([row({ audienceEveryone: false })]);
    expect(await resolveActiveActivitiesForUser("ada", noRoles, now, "/")).toEqual([]);
  });

  it("maps a live activity with an ISO end and no overlay when the mechanic is unknown", async () => {
    prismaMock.activity.findMany.mockResolvedValue([row()]);
    expect(await resolveActiveActivitiesForUser("ada", noRoles, now, "/")).toEqual([
      { id: "a1", kind: "scavenger_hunt", name: "Hunt", endsAt: "2026-09-20T00:00:00.000Z", overlay: null, progressLabel: null },
    ]);
    expect(prismaMock.activityEvent.findMany).not.toHaveBeenCalled();
  });

  it("builds the overlay for the current pathname and a progress label from the member's own events", async () => {
    const events = [{ id: "e1" }];
    mech.current = {
      overlayPayload: vi.fn(() => ({ code: "x" })),
      bannerSummary: vi.fn(() => "2/8"),
    };
    prismaMock.activity.findMany.mockResolvedValue([row()]);
    prismaMock.activityEvent.findMany.mockResolvedValue(events);
    const [out] = await resolveActiveActivitiesForUser("ada", noRoles, now, "/docs");
    expect(out).toMatchObject({ overlay: { code: "x" }, progressLabel: "2/8" });
    expect(mech.current.overlayPayload).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }), "/docs");
    expect(prismaMock.activityEvent.findMany).toHaveBeenCalledWith({ where: { activityId: "a1", userId: "ada" } });
    expect(mech.current.bannerSummary).toHaveBeenCalledWith(expect.anything(), events);
  });

  it("counts the whole team's events in Team mode", async () => {
    mech.current = { bannerSummary: vi.fn(() => "5/8") };
    prismaMock.activity.findMany.mockResolvedValue([row({ scoring: "Team" })]);
    prismaMock.activityParticipant.findUnique.mockResolvedValue({ teamId: "t1" });
    prismaMock.activityTeam.findUnique.mockResolvedValue({ id: "t1", name: "Red", members: [{ userId: "ada" }, { userId: "grace" }] });
    prismaMock.activityEvent.findMany.mockResolvedValue([]);
    await resolveActiveActivitiesForUser("ada", noRoles, now, "/");
    expect(prismaMock.activityEvent.findMany).toHaveBeenCalledWith({
      where: { activityId: "a1", userId: { in: ["ada", "grace"] } },
    });
  });

  it("omits activities outside their window", async () => {
    prismaMock.activity.findMany.mockResolvedValue([
      row({ id: "future", startsAt: new Date("2026-09-16T00:00:00Z") }),
      row({ id: "ended", endsAt: new Date("2026-09-14T00:00:00Z") }),
    ]);
    expect(await resolveActiveActivitiesForUser("ada", noRoles, now, "/")).toEqual([]);
  });
});

describe("getActivityForMember", () => {
  it("is null for an unknown activity", async () => {
    prismaMock.activity.findUnique.mockResolvedValue(null);
    expect(await getActivityForMember("x", "ada", noRoles)).toBeNull();
  });

  it("reports assignment and whether it is live (Published and in-window only)", async () => {
    const base = {
      id: "a1", scoring: "Individual", audienceEveryone: false, audienceRoles: [], assignedGroupId: null,
      startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 86_400_000),
    };
    prismaMock.activity.findUnique.mockResolvedValue({ ...base, status: "Published" });
    let res = await getActivityForMember("a1", "ada", noRoles);
    expect(res).toMatchObject({ assigned: false, active: true, team: null });
    prismaMock.activity.findUnique.mockResolvedValue({ ...base, status: "Draft" });
    res = await getActivityForMember("a1", "ada", noRoles);
    expect(res?.active).toBe(false);
  });
});

describe("admin CRUD", () => {
  const start = new Date("2026-09-10T00:00:00Z");
  const end = new Date("2026-09-20T00:00:00Z");

  it("listActivitiesForAdmin flattens counts", async () => {
    prismaMock.activity.findMany.mockResolvedValue([
      { id: "a1", kind: "scavenger_hunt", name: "H", status: "Draft", termId: null, startsAt: start, endsAt: end, _count: { participants: 3, events: 7 } },
    ]);
    expect(await listActivitiesForAdmin()).toEqual([
      { id: "a1", kind: "scavenger_hunt", name: "H", status: "Draft", termId: null, startsAt: start, endsAt: end, participantCount: 3, eventCount: 7 },
    ]);
    expect(prismaMock.activity.findMany.mock.calls[0][0].orderBy).toEqual([{ startsAt: "desc" }]);
  });

  describe("createActivity", () => {
    it("rejects kinds outside the registry", async () => {
      await expect(createActivity({ kind: "bogus", name: "x", termId: null, startsAt: start, endsAt: end }, "ada")).rejects.toThrow("Unknown activity kind: bogus");
      expect(prismaMock.activity.create).not.toHaveBeenCalled();
    });

    it("creates a Draft seeded with the mechanic's default config and the creator", async () => {
      const parseConfig = vi.fn(() => ({ codes: [] }));
      mech.current = { parseConfig };
      await createActivity({ kind: "scavenger_hunt", name: "H", termId: "t1", startsAt: start, endsAt: end }, "ada");
      expect(parseConfig).toHaveBeenCalledWith({});
      expect(prismaMock.activity.create).toHaveBeenCalledWith({
        data: { kind: "scavenger_hunt", name: "H", termId: "t1", startsAt: start, endsAt: end, status: "Draft", config: { codes: [] }, createdById: "ada" },
      });
    });

    it("uses an empty config when no server mechanic is registered", async () => {
      await createActivity({ kind: "scavenger_hunt", name: "H", termId: null, startsAt: start, endsAt: end }, "ada");
      expect(prismaMock.activity.create.mock.calls[0][0].data.config).toEqual({});
    });
  });

  describe("updateActivity", () => {
    it("throws for a missing activity", async () => {
      prismaMock.activity.findUnique.mockResolvedValue(null);
      await expect(updateActivity("x", { name: "n" })).rejects.toThrow("Activity not found");
      expect(prismaMock.activity.update).not.toHaveBeenCalled();
    });

    it("writes only the fields supplied", async () => {
      prismaMock.activity.findUnique.mockResolvedValue({ id: "a1", kind: "scavenger_hunt" });
      await updateActivity("a1", { name: "New", assignedGroupId: null, audienceEveryone: false });
      expect(prismaMock.activity.update).toHaveBeenCalledWith({
        where: { id: "a1" },
        data: { name: "New", assignedGroupId: null, audienceEveryone: false },
      });
    });

    it("drops unknown audience roles and clamps team size", async () => {
      prismaMock.activity.findUnique.mockResolvedValue({ id: "a1", kind: "scavenger_hunt" });
      await updateActivity("a1", { audienceRoles: ["isCore", "isBogus", "isAlumni"], teamSize: 99 });
      expect(prismaMock.activity.update.mock.calls[0][0].data).toEqual({ audienceRoles: ["isCore", "isAlumni"], teamSize: 12 });
      await updateActivity("a1", { teamSize: 0 });
      expect(prismaMock.activity.update.mock.calls[1][0].data).toEqual({ teamSize: 2 });
    });

    it("runs config through the activity's mechanic parser, and stores raw config when none", async () => {
      prismaMock.activity.findUnique.mockResolvedValue({ id: "a1", kind: "scavenger_hunt" });
      mech.current = { parseConfig: vi.fn(() => ({ parsed: true })) };
      await updateActivity("a1", { config: { junk: 1 } });
      expect(mech.current.parseConfig).toHaveBeenCalledWith({ junk: 1 });
      expect(prismaMock.activity.update.mock.calls[0][0].data.config).toEqual({ parsed: true });
      mech.current = null;
      await updateActivity("a1", { config: { junk: 1 } });
      expect(prismaMock.activity.update.mock.calls[1][0].data.config).toEqual({ junk: 1 });
    });
  });

  it("setActivityStatus and deleteActivity write by id", async () => {
    await setActivityStatus("a1", "Published");
    expect(prismaMock.activity.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { status: "Published" } });
    await deleteActivity("a1");
    expect(prismaMock.activity.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
  });

  describe("cloneActivity", () => {
    it("throws for a missing source", async () => {
      prismaMock.activity.findUnique.mockResolvedValue(null);
      await expect(cloneActivity("x", "ada")).rejects.toThrow("Activity not found");
    });

    it("copies setup into a fresh Draft with no term, attributing the cloner", async () => {
      prismaMock.activity.findUnique.mockResolvedValue({
        id: "a1", kind: "scavenger_hunt", name: "Hunt", termId: "t1", startsAt: start, endsAt: end, status: "Published",
        audienceEveryone: false, audienceRoles: ["isCore"], assignedGroupId: "g1", scoring: "Team", teamSize: 4,
        config: { codes: ["a"] }, createdById: "someone-else",
      });
      await cloneActivity("a1", "grace");
      expect(prismaMock.activity.create).toHaveBeenCalledWith({
        data: {
          kind: "scavenger_hunt", name: "Hunt (copy)", termId: null, startsAt: start, endsAt: end, status: "Draft",
          audienceEveryone: false, audienceRoles: ["isCore"], assignedGroupId: "g1", scoring: "Team", teamSize: 4,
          config: { codes: ["a"] }, createdById: "grace",
        },
      });
    });
  });
});
