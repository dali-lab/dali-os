import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn(),
  getActiveCoreCycleTermIds: vi.fn(),
  isLabMentor: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { currentTerm, getActiveCoreCycleTermIds } from "~/lib/roles";
import {
  listActiveGroupNamesForUser,
  listActiveGroupsForUser,
  listAllGroups,
  listVisibleGroupsForUser,
  resolveDynamicQueries,
} from "../groups";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const CURRENT = "term-26F";

// The calendar and profile pages list every group; resolving them one by one
// fired ~110 queries at once and queued every other request on the machine.
// These pin that each kind of group costs a fixed number of reads.

type Row = Record<string, string>;
const inFilter = (rows: Row[], field: string) => async (args: { where: Record<string, { in: string[] }> }) =>
  rows.filter((r) => args.where[field]!.in.includes(r[field]!));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(currentTerm).mockResolvedValue({ id: CURRENT } as never);
  vi.mocked(getActiveCoreCycleTermIds).mockResolvedValue([CURRENT]);
  for (const model of [
    "projectAssignment",
    "coreAssignment",
    "instructorAssignment",
    "mentorshipPair",
    "domainEligibility",
    "educationApplication",
    "domainLeadAssignment",
    "cycleReviewer",
    "cycleInterviewer",
    "user",
    "term",
    "project",
  ]) {
    mockPrisma[model]!.findMany.mockResolvedValue([]);
  }
});

describe("resolveDynamicQueries", () => {
  it("reads each term table once for many term groups and splits the members per term", async () => {
    mockPrisma.projectAssignment!.findMany.mockImplementation(
      inFilter(
        [
          { termId: "t1", userId: "ada" },
          { termId: "t2", userId: "grace" },
        ],
        "termId",
      ),
    );
    mockPrisma.mentorshipPair!.findMany.mockResolvedValue([
      { termId: "t2", menteeUserId: "alan", mentorUserId: "ada" },
    ]);

    const members = await resolveDynamicQueries(["term:t1", "term:t2", "term:t3"]);

    expect(members.get("term:t1")).toEqual(["ada"]);
    expect(members.get("term:t2")!.sort()).toEqual(["ada", "alan", "grace"]);
    expect(members.get("term:t3")).toEqual([]);
    for (const model of ["projectAssignment", "coreAssignment", "instructorAssignment", "mentorshipPair"]) {
      expect(mockPrisma[model]!.findMany).toHaveBeenCalledOnce();
    }
    expect(mockPrisma.projectAssignment!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { termId: { in: ["t1", "t2", "t3"] } } }),
    );
  });

  it("reads project assignments once for many project groups, scoped to the current term", async () => {
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([
      { projectId: "p1", userId: "ada" },
      { projectId: "p1", userId: "ada" },
      { projectId: "p2", userId: "grace" },
    ]);

    const members = await resolveDynamicQueries(["project:p1", "project:p2"]);

    expect(Object.fromEntries(members)).toEqual({ "project:p1": ["ada"], "project:p2": ["grace"] });
    expect(mockPrisma.projectAssignment!.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { projectId: { in: ["p1", "p2"] }, termId: CURRENT },
      select: { projectId: true, userId: true },
    });
  });

  it("reads domain eligibility once for many domain groups", async () => {
    mockPrisma.domainEligibility!.findMany.mockImplementation(
      inFilter(
        [
          { domainId: "d1", userId: "ada" },
          { domainId: "d2", userId: "grace" },
        ],
        "domainId",
      ),
    );

    const members = await resolveDynamicQueries(["domain:d1", "domain:d2"]);

    expect(Object.fromEntries(members)).toEqual({ "domain:d1": ["ada"], "domain:d2": ["grace"] });
    expect(mockPrisma.domainEligibility!.findMany).toHaveBeenCalledOnce();
  });

  it("reads approved applications once for many offering groups", async () => {
    mockPrisma.educationApplication!.findMany.mockResolvedValue([
      { offeringId: "o1", applicantUserId: "ada" },
      { offeringId: "o2", applicantUserId: "grace" },
    ]);

    const members = await resolveDynamicQueries(["offering:o1", "offering:o2"]);

    expect(Object.fromEntries(members)).toEqual({ "offering:o1": ["ada"], "offering:o2": ["grace"] });
    expect(mockPrisma.educationApplication!.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { offeringId: { in: ["o1", "o2"] }, status: "Approved" },
      select: { offeringId: true, applicantUserId: true },
    });
  });

  it("resolves alumni once however many groups use it", async () => {
    mockPrisma.user!.findMany.mockResolvedValue([{ id: "ada" }]);

    const members = await resolveDynamicQueries(["alumni", "alumni"]);

    expect(members.get("alumni")).toEqual(["ada"]);
    expect(mockPrisma.user!.findMany).toHaveBeenCalledOnce();
  });

  it("answers empty for a malformed or unknown query without reading anything", async () => {
    const members = await resolveDynamicQueries(["term:", "project:", "nonsense:x", "constructor:x"]);

    expect(Object.fromEntries(members)).toEqual({
      "term:": [],
      "project:": [],
      "nonsense:x": [],
      "constructor:x": [],
    });
    for (const model of ["projectAssignment", "coreAssignment", "domainEligibility"]) {
      expect(mockPrisma[model]!.findMany).not.toHaveBeenCalled();
    }
  });

  it("leaves every project group empty when there is no current term", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);

    expect((await resolveDynamicQueries(["project:p1"])).get("project:p1")).toEqual([]);
    expect(mockPrisma.projectAssignment!.findMany).not.toHaveBeenCalled();
  });
});

const groupRow = (id: string, over: Partial<Record<string, unknown>> = {}) => ({
  id,
  name: id,
  type: "Dynamic",
  dynamicQuery: null,
  staticMemberIds: [],
  systemKey: null,
  archivedAt: null,
  boundTermIds: [],
  ...over,
});

describe("listAllGroups", () => {
  it("costs the same reads for 3 groups of a kind as for 30", async () => {
    const reads = async (count: number) => {
      vi.clearAllMocks();
      mockPrisma.groupDefinition!.findMany.mockResolvedValue(
        Array.from({ length: count }, (_, i) => [
          groupRow(`term-${i}`, { dynamicQuery: `term:t${i}` }),
          groupRow(`project-${i}`, { dynamicQuery: `project:p${i}` }),
          groupRow(`domain-${i}`, { dynamicQuery: `domain:d${i}` }),
        ]).flat(),
      );
      await listAllGroups();
      return Object.fromEntries(
        Object.entries(mockPrisma).map(([model, fns]) => [model, fns.findMany?.mock.calls.length ?? 0]),
      );
    };

    expect(await reads(30)).toEqual(await reads(3));
  });

  it("returns each group's own members, static and dynamic, with archive state", async () => {
    mockPrisma.term!.findMany.mockResolvedValue([{ id: "t-old", endDate: new Date("2020-01-01") }]);
    mockPrisma.groupDefinition!.findMany.mockResolvedValue([
      groupRow("static", { type: "Static", staticMemberIds: ["grace"] }),
      groupRow("old-term", { dynamicQuery: "term:t-old", systemKey: "term:t-old" }),
      groupRow("domain", { dynamicQuery: "domain:d1" }),
      groupRow("no-query"),
    ]);
    mockPrisma.coreAssignment!.findMany.mockResolvedValue([{ termId: "t-old", userId: "ada" }]);
    mockPrisma.domainEligibility!.findMany.mockResolvedValue([{ domainId: "d1", userId: "alan" }]);

    const groups = await listAllGroups();

    expect(groups.map((g) => [g.id, g.memberIds, g.archived])).toEqual([
      ["static", ["grace"], false],
      ["old-term", ["ada"], true],
      ["domain", ["alan"], false],
      ["no-query", [], false],
    ]);
  });
});

describe("listVisibleGroupsForUser", () => {
  it("resolves the members of every group the user is in with one read per table", async () => {
    mockPrisma.groupDefinition!.findMany.mockResolvedValue([
      groupRow("t1", { dynamicQuery: "term:t1" }),
      groupRow("t2", { dynamicQuery: "term:t2" }),
    ]);
    mockPrisma.projectAssignment!.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.userId
        ? [
            { termId: "t1", projectId: "p" },
            { termId: "t2", projectId: "p" },
          ]
        : [
            { termId: "t1", userId: "ada" },
            { termId: "t2", userId: "ada" },
            { termId: "t2", userId: "grace" },
          ],
    );

    const groups = await listVisibleGroupsForUser("ada");

    expect(groups.map((g) => [g.id, g.memberIds])).toEqual([
      ["t1", ["ada"]],
      ["t2", ["ada", "grace"]],
    ]);
    // One read for the user's own rows, one for both groups' members.
    expect(mockPrisma.projectAssignment!.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("listActiveGroupsForUser", () => {
  beforeEach(() => {
    mockPrisma.term!.findMany.mockResolvedValue([{ id: "t-old", endDate: new Date("2020-01-01") }]);
    mockPrisma.groupDefinition!.findMany.mockResolvedValue([
      groupRow("mine", { type: "Static", staticMemberIds: ["ada"] }),
      groupRow("mine-archived", { type: "Static", staticMemberIds: ["ada"], archivedAt: new Date("2025-01-01") }),
      groupRow("not-mine", { type: "Static", staticMemberIds: ["grace"] }),
      groupRow("old-term", { dynamicQuery: "term:t-old", systemKey: "term:t-old" }),
      groupRow("alumni", { dynamicQuery: "alumni", systemKey: "alumni" }),
    ]);
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([{ termId: "t-old", projectId: "p" }]);
    mockPrisma.user!.findUnique.mockResolvedValue({ membershipStatus: "Alumni", daliMember: { userId: "ada" } });
  });

  it("lists the user's live groups without resolving anyone's member list", async () => {
    mockPrisma.user!.findMany.mockResolvedValue([{ id: "ada" }]);

    expect(await listActiveGroupsForUser("ada")).toEqual([
      { id: "mine", name: "mine", systemKey: null },
      { id: "alumni", name: "alumni", systemKey: "alumni" },
    ]);
    // The alumni roster (hundreds of people) is never read.
    expect(mockPrisma.user!.findMany).not.toHaveBeenCalled();
  });

  it("backs the names-only list", async () => {
    expect(await listActiveGroupNamesForUser("ada")).toEqual(["mine", "alumni"]);
  });
});
