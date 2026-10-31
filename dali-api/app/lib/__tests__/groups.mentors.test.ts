import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn(),
  getActiveCoreCycleTermIds: vi.fn(),
  isLabMentor: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { currentTerm, getActiveCoreCycleTermIds, isLabMentor } from "~/lib/roles";
import {
  resolveDynamicQuery,
  resolveDynamicQueries,
  listVisibleGroupIdsForUser,
  ensureMentorsGroup,
  syncDefaultGroups,
} from "../groups";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const TERM = "term-26S";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(currentTerm).mockResolvedValue({ id: TERM } as never);
  vi.mocked(getActiveCoreCycleTermIds).mockResolvedValue([TERM]);
  mockPrisma.projectAssignment!.findMany.mockResolvedValue([]);
  mockPrisma.domainLeadAssignment!.findMany.mockResolvedValue([]);
  mockPrisma.coreAssignment!.findMany.mockResolvedValue([]);
  mockPrisma.user!.findMany.mockResolvedValue([]);
});

describe("mentors group membership", () => {
  it("unions P3 assignees, domain leads, PM mentors and Core, deduped", async () => {
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([
      { userId: "p3-only" },
      { userId: "p3-and-lead" },
    ]);
    mockPrisma.domainLeadAssignment!.findMany.mockResolvedValue([
      { userId: "lead-only" },
      { userId: "p3-and-lead" },
    ]);
    mockPrisma.user!.findMany.mockResolvedValue([{ id: "pm-mentor" }, { id: "p3-only" }]);
    mockPrisma.coreAssignment!.findMany.mockResolvedValue([
      { userId: "core-only" },
      { userId: "lead-only" },
    ]);

    const members = await resolveDynamicQuery("mentors");

    expect(members.sort()).toEqual(
      ["core-only", "lead-only", "p3-and-lead", "p3-only", "pm-mentor"].sort(),
    );
    expect(new Set(members).size).toBe(members.length);
  });

  it("scopes every query to the current term", async () => {
    await resolveDynamicQuery("mentors");

    expect(mockPrisma.projectAssignment!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { termId: TERM, level: "P3" } }),
    );
    expect(mockPrisma.domainLeadAssignment!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { termId: TERM } }),
    );
    expect(mockPrisma.coreAssignment!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { termId: { in: [TERM] } } }),
    );
  });

  it("counts a PM P3 mentor only with some current-term role", async () => {
    await resolveDynamicQuery("mentors");

    expect(mockPrisma.user!.findMany).toHaveBeenCalledWith({
      where: {
        domainEligibilities: { some: { level: "P3", domain: { code: "PM" } } },
        OR: [
          { projectAssignments: { some: { termId: TERM } } },
          { coreAssignments: { some: { termId: TERM } } },
          { domainLeadAssignmentsAsUser: { some: { termId: TERM } } },
          { instructorAssignments: { some: { termId: TERM } } },
        ],
      },
      select: { id: true },
    });
  });

  it("is empty, and queries nothing, when there is no current term", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);

    expect(await resolveDynamicQuery("mentors")).toEqual([]);
    expect(mockPrisma.projectAssignment!.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.domainLeadAssignment!.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.user!.findMany).not.toHaveBeenCalled();
  });

  it("reads Core once when core, hiring and mentors resolve together", async () => {
    mockPrisma.cycleReviewer!.findMany.mockResolvedValue([]);
    mockPrisma.cycleInterviewer!.findMany.mockResolvedValue([]);
    mockPrisma.coreAssignment!.findMany.mockResolvedValue([{ userId: "shared-core" }]);

    const members = await resolveDynamicQueries(["core", "hiring", "mentors"]);

    expect(Object.fromEntries(members)).toEqual({
      core: ["shared-core"],
      hiring: ["shared-core"],
      mentors: ["shared-core"],
    });
    expect(mockPrisma.coreAssignment!.findMany).toHaveBeenCalledOnce();
  });
});

describe("mentors group membership, resolved per user", () => {
  beforeEach(() => {
    mockPrisma.groupDefinition!.findMany.mockResolvedValue([
      {
        id: "g-mentors",
        name: "Mentors",
        type: "Dynamic",
        dynamicQuery: "mentors",
        staticMemberIds: [],
        systemKey: "mentors",
        archivedAt: null,
        boundTermIds: [],
      },
    ]);
    mockPrisma.term!.findMany.mockResolvedValue([]);
    mockPrisma.user!.findUnique.mockResolvedValue(null);
  });

  it("puts a lab mentor in the group", async () => {
    vi.mocked(isLabMentor).mockResolvedValue(true);

    const ids = await listVisibleGroupIdsForUser("mentor");

    expect(ids.map((g) => g.id)).toEqual(["g-mentors"]);
    expect(isLabMentor).toHaveBeenCalledWith("mentor", TERM, undefined);
  });

  it("keeps a non-mentor out of the group", async () => {
    vi.mocked(isLabMentor).mockResolvedValue(false);

    expect(await listVisibleGroupIdsForUser("mentee")).toEqual([]);
  });

  it("admits a Core member without needing the mentor predicate", async () => {
    mockPrisma.coreAssignment!.findMany.mockResolvedValue([{ termId: TERM }]);
    vi.mocked(isLabMentor).mockResolvedValue(false);

    const ids = await listVisibleGroupIdsForUser("core-member");

    expect(ids.map((g) => g.id)).toEqual(["g-mentors"]);
    expect(isLabMentor).not.toHaveBeenCalled();
  });

  it("does not evaluate the mentor predicate when no mentors group exists", async () => {
    mockPrisma.groupDefinition!.findMany.mockResolvedValue([]);

    await listVisibleGroupIdsForUser("anyone");

    expect(isLabMentor).not.toHaveBeenCalled();
  });

  it("agrees with the forward resolver on who is in the group", async () => {
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([{ userId: "p3" }]);
    mockPrisma.coreAssignment!.findMany.mockImplementation(
      async (args: { where: { userId?: string } }) =>
        args.where.userId === "core"
          ? [{ termId: TERM }]
          : args.where.userId
            ? []
            : [{ userId: "core" }],
    );
    const mentors = new Set(["p3"]);
    vi.mocked(isLabMentor).mockImplementation(async (id: string) => mentors.has(id));

    const forward = (await resolveDynamicQuery("mentors")).sort();
    const inverse: string[] = [];
    for (const userId of ["p3", "core", "mentee"]) {
      const ids = await listVisibleGroupIdsForUser(userId);
      if (ids.some((g) => g.id === "g-mentors")) inverse.push(userId);
    }

    expect(inverse.sort()).toEqual(forward);
  });
});

describe("ensureMentorsGroup", () => {
  it("upserts the system group by systemKey without overwriting an existing row", async () => {
    mockPrisma.groupDefinition!.upsert.mockResolvedValue({});

    await ensureMentorsGroup();
    await ensureMentorsGroup();

    expect(mockPrisma.groupDefinition!.upsert).toHaveBeenCalledTimes(2);
    for (const [args] of mockPrisma.groupDefinition!.upsert.mock.calls) {
      expect(args).toEqual({
        where: { systemKey: "mentors" },
        update: {},
        create: {
          name: "Mentors",
          type: "Dynamic",
          dynamicQuery: "mentors",
          systemKey: "mentors",
        },
      });
    }
  });

  it("is part of the default groups", async () => {
    mockPrisma.term!.findMany.mockResolvedValue([]);
    mockPrisma.project!.findMany.mockResolvedValue([]);
    mockPrisma.domain!.findMany.mockResolvedValue([]);
    mockPrisma.groupDefinition!.upsert.mockResolvedValue({});

    await syncDefaultGroups();

    const keys = mockPrisma.groupDefinition!.upsert.mock.calls.map(
      ([args]) => args.where.systemKey,
    );
    expect(keys).toEqual(expect.arrayContaining(["core", "hiring", "mentors", "alumni"]));
  });
});
