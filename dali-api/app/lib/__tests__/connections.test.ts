import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { buildConnections } from "~/lib/connections";
import type { ConnectionsResult, EdgeType } from "~/lib/connections";

// The connections lib is passed `prisma` explicitly; we hand it the mocked
// client so each branch is exercised against fixed join rows.
const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default every findMany used by the lib to empty so a branch only sees the
  // rows a given test seeds.
  for (const model of [
    "projectDomain",
    "projectTerm",
    "projectPartner",
    "projectAssignment",
    "mentorshipPair",
    "projectRoleRequest",
    "epic",
    "sprint",
    "task",
    "domainEligibility",
    "staffingAssignment",
    "taskAssignee",
    "projectFileTag",
  ]) {
    mockPrisma[model]!.findMany.mockResolvedValue([]);
  }
  mockPrisma.project!.findMany.mockResolvedValue([]);
});

const D = (id: string, displayName: string) => ({ id, displayName, name: displayName });
const U = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName });

function edgesOfType(res: ConnectionsResult, type: EdgeType) {
  return res.edges.filter((e) => e.type === type);
}

describe("buildConnections — project", () => {
  it("returns focus node flagged isFocus and maps each join row to an edge", async () => {
    mockPrisma.project!.findUnique.mockResolvedValue({ id: "p1", name: "Alpha" });
    mockPrisma.projectDomain!.findMany.mockResolvedValue([
      { domain: D("d1", "Fullstack") },
      { domain: D("d2", "UI/UX") },
    ]);
    mockPrisma.projectTerm!.findMany.mockResolvedValue([{ term: { id: "t1", code: "26S" } }]);
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([
      { level: "P2", user: U("u1", "Ada", "Lovelace"), term: { code: "26S" } },
    ]);

    const res = await buildConnections(prisma as never, "project", "p1");

    expect(res.focus.id).toBe("project:p1");
    expect(res.focus.isFocus).toBe(true);
    expect(res.nodes.find((n) => n.id === "project:p1")?.isFocus).toBe(true);

    expect(edgesOfType(res, "declares_domain")).toHaveLength(2);
    expect(edgesOfType(res, "runs_in_term")).toHaveLength(1);

    const assigned = edgesOfType(res, "assigned_to");
    expect(assigned).toHaveLength(1);
    // assignment edge carries level + termCode in meta
    expect(assigned[0]!.meta).toMatchObject({ level: "P2", termCode: "26S" });
    // and points user -> project
    expect(assigned[0]!.source).toBe("user:u1");
    expect(assigned[0]!.target).toBe("project:p1");

    expect(res.truncated).toBe(false);
  });

  it("de-dupes a neighbor reached via two different relations", async () => {
    mockPrisma.project!.findUnique.mockResolvedValue({ id: "p1", name: "Alpha" });
    // Same domain d1 appears both as a declared domain and a role request.
    mockPrisma.projectDomain!.findMany.mockResolvedValue([{ domain: D("d1", "Fullstack") }]);
    mockPrisma.projectRoleRequest!.findMany.mockResolvedValue([
      { level: "P3", slots: 2, domain: D("d1", "Fullstack"), term: { code: "26S" } },
    ]);

    const res = await buildConnections(prisma as never, "project", "p1");

    // One domain node, but two distinct edge types to it.
    const domainNodes = res.nodes.filter((n) => n.id === "domain:d1");
    expect(domainNodes).toHaveLength(1);
    expect(edgesOfType(res, "declares_domain")).toHaveLength(1);
    expect(edgesOfType(res, "requests_role")).toHaveLength(1);
  });

  it("honors the per-edge-type fan-out cap and sets truncated", async () => {
    mockPrisma.project!.findUnique.mockResolvedValue({ id: "p1", name: "Alpha" });
    // 30 declared domains, cap at 5.
    const domains = Array.from({ length: 30 }, (_, i) => ({ domain: D(`d${i}`, `Domain ${i}`) }));
    mockPrisma.projectDomain!.findMany.mockResolvedValue(domains);

    const res = await buildConnections(prisma as never, "project", "p1", {
      limitPerEdgeType: 5,
    });

    expect(edgesOfType(res, "declares_domain")).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });

  it("scopes assignment edges to a term when termId is passed", async () => {
    mockPrisma.project!.findUnique.mockResolvedValue({ id: "p1", name: "Alpha" });
    await buildConnections(prisma as never, "project", "p1", { termId: "t1" });
    expect(mockPrisma.projectAssignment!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "p1", termId: "t1" } }),
    );
  });

  it("includes tag edges only when includeTags is set", async () => {
    mockPrisma.project!.findUnique.mockResolvedValue({ id: "p1", name: "Alpha" });
    mockPrisma.projectFileTag!.findMany.mockResolvedValue([
      { tag: { id: "tag1", label: "research" } },
    ]);

    const without = await buildConnections(prisma as never, "project", "p1");
    expect(edgesOfType(without, "tagged")).toHaveLength(0);

    const withTags = await buildConnections(prisma as never, "project", "p1", {
      includeTags: true,
    });
    expect(edgesOfType(withTags, "tagged")).toHaveLength(1);
  });
});

describe("buildConnections — user", () => {
  it("maps eligibility, assignment, staffing, and mentorship edges with meta", async () => {
    mockPrisma.user!.findUnique.mockResolvedValue(U("u1", "Ada", "Lovelace"));
    mockPrisma.domainEligibility!.findMany.mockResolvedValue([
      { level: "P3", domain: D("d1", "Fullstack") },
    ]);
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([
      { level: "P2", project: { id: "p1", name: "Alpha" }, term: { code: "26S" } },
    ]);
    mockPrisma.staffingAssignment!.findMany.mockResolvedValue([
      { projectId: "p2", level: "P1", status: "Proposed", term: { code: "26X" } },
    ]);
    mockPrisma.project!.findMany.mockResolvedValue([{ id: "p2", name: "Beta" }]);
    // mentorAs (this user mentors someone)
    mockPrisma.mentorshipPair!.findMany
      .mockResolvedValueOnce([
        { mentee: U("u2", "Grace", "Hopper"), term: { code: "26S" }, domain: D("d1", "Fullstack") },
      ])
      .mockResolvedValueOnce([]); // menteeAs

    const res = await buildConnections(prisma as never, "user", "u1");

    expect(res.focus.id).toBe("user:u1");

    expect(edgesOfType(res, "eligible_in")[0]!.meta).toMatchObject({ level: "P3" });
    expect(edgesOfType(res, "assigned_to")[0]!.meta).toMatchObject({
      level: "P2",
      termCode: "26S",
    });
    const staffed = edgesOfType(res, "staffed_on");
    expect(staffed).toHaveLength(1);
    expect(staffed[0]!.meta).toMatchObject({ status: "Proposed", level: "P1" });
    expect(res.nodes.find((n) => n.id === "project:p2")?.label).toBe("Beta");

    const mentors = edgesOfType(res, "mentors");
    expect(mentors).toHaveLength(1);
    expect(mentors[0]!.source).toBe("user:u1");
    expect(mentors[0]!.target).toBe("user:u2");
  });

  it("gives every re-centerable node an href to its connections view", async () => {
    mockPrisma.user!.findUnique.mockResolvedValue(U("u1", "Ada", "Lovelace"));
    mockPrisma.domainEligibility!.findMany.mockResolvedValue([
      { level: "P3", domain: D("d1", "Fullstack") },
    ]);
    const res = await buildConnections(prisma as never, "user", "u1");
    expect(res.focus.href).toBe("/connections/user/u1");
    expect(res.nodes.find((n) => n.id === "domain:d1")?.href).toBe("/connections/domain/d1");
  });
});

describe("buildConnections — domain", () => {
  it("maps projects and members onto the domain focus", async () => {
    mockPrisma.domain!.findUnique.mockResolvedValue(D("d1", "Fullstack"));
    mockPrisma.projectDomain!.findMany.mockResolvedValue([
      { project: { id: "p1", name: "Alpha" } },
    ]);
    mockPrisma.domainEligibility!.findMany.mockResolvedValue([
      { level: "P2", user: U("u1", "Ada", "Lovelace") },
    ]);

    const res = await buildConnections(prisma as never, "domain", "d1");

    expect(res.focus.id).toBe("domain:d1");
    expect(edgesOfType(res, "declares_domain")).toHaveLength(1);
    expect(edgesOfType(res, "eligible_in")).toHaveLength(1);
    expect(edgesOfType(res, "eligible_in")[0]!.target).toBe("domain:d1");
  });
});

describe("buildConnections — depth", () => {
  it("depth:1 (default) does not expand a second hop", async () => {
    mockPrisma.user!.findUnique.mockResolvedValue(U("u1", "Ada", "Lovelace"));
    mockPrisma.domainEligibility!.findMany.mockResolvedValue([
      { level: "P3", domain: D("d1", "Fullstack") },
    ]);

    await buildConnections(prisma as never, "user", "u1");

    // The neighbor domain's own branch (domain.findUnique) must NOT be called.
    expect(mockPrisma.domain!.findUnique).not.toHaveBeenCalled();
  });

  it("depth:2 expands first-hop neighbors but never a third hop", async () => {
    // Focus user u1 → domain d1 (hop 1). At hop 2, d1's branch runs and finds
    // member u2 (eligible in d1). u2 is hop 2 and must NOT be expanded further.
    mockPrisma.user!.findUnique.mockResolvedValue(U("u1", "Ada", "Lovelace"));
    mockPrisma.domainEligibility!.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if (where.userId === "u1") return Promise.resolve([{ level: "P3", domain: D("d1", "Fullstack") }]);
      if (where.domainId === "d1") return Promise.resolve([{ level: "P2", user: U("u2", "Grace", "Hopper") }]);
      return Promise.resolve([]);
    });

    const res = await buildConnections(prisma as never, "user", "u1", { depth: 2 });

    // u2 reached at hop 2.
    expect(res.nodes.find((n) => n.id === "user:u2")).toBeDefined();
    // u1 (focus) + u2; user.findUnique called for focus + the hop-1 nothing
    // else. The domain branch ran for d1; but u2's own user branch (a third
    // hop) must not run. user.findUnique is only ever called for the focus.
    const userFindUniqueCalls = mockPrisma.user!.findUnique.mock.calls.map(
      (c: unknown[]) => (c[0] as { where: { id: string } }).where.id,
    );
    expect(userFindUniqueCalls).toEqual(["u1"]);
  });
});

describe("buildConnections — not found", () => {
  it("throws a 404 Response when the entity does not exist", async () => {
    mockPrisma.project!.findUnique.mockResolvedValue(null);
    await expect(buildConnections(prisma as never, "project", "missing")).rejects.toMatchObject({
      status: 404,
    });
  });
});
