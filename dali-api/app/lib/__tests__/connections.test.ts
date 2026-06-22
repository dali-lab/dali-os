import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { buildGlobalGraph } from "~/lib/connections";
import type { GlobalGraph, EdgeType, NodeType } from "~/lib/connections";

// buildGlobalGraph is passed `prisma` explicitly; we hand it the mocked client
// so each table returns fixed rows.
const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

// Every table the builder reads — entity tables and join tables — default to
// empty so a test only sees the rows it seeds.
const TABLES = [
  "project",
  "user",
  "domain",
  "term",
  "partnerOrg",
  "epic",
  "sprint",
  "task",
  "page",
  "projectFile",
  "projectDomain",
  "projectTerm",
  "projectPartner",
  "projectAssignment",
  "staffingAssignment",
  "mentorshipPair",
  "domainEligibility",
  "projectRoleRequest",
  "taskAssignee",
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const t of TABLES) mockPrisma[t]!.findMany.mockResolvedValue([]);
});

const D = (id: string, displayName: string) => ({ id, displayName, name: displayName });
const U = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName });

function edgesOfType(g: GlobalGraph, type: EdgeType) {
  return g.edges.filter((e) => e.type === type);
}
function nodeIds(g: GlobalGraph, type: NodeType) {
  return g.nodes.filter((n) => n.id.startsWith(`${type}:`)).map((n) => n.id);
}

describe("buildGlobalGraph — nodes", () => {
  it("creates one namespaced node per entity row, with hrefs where pages exist", async () => {
    mockPrisma.project!.findMany.mockResolvedValue([{ id: "p1", name: "Alpha" }]);
    mockPrisma.user!.findMany.mockResolvedValue([U("u1", "Ada", "Lovelace")]);
    mockPrisma.domain!.findMany.mockResolvedValue([D("d1", "Fullstack")]);
    mockPrisma.term!.findMany.mockResolvedValue([{ id: "t1", code: "26S" }]);

    const g = await buildGlobalGraph(prisma as never);

    expect(g.nodes.find((n) => n.id === "project:p1")).toMatchObject({
      type: "project",
      label: "Alpha",
      href: "/projects/p1",
    });
    expect(g.nodes.find((n) => n.id === "person:u1")).toMatchObject({
      type: "person",
      label: "Ada Lovelace",
      href: "/members/u1",
    });
    // domains/terms have no standalone page → no href
    expect(g.nodes.find((n) => n.id === "domain:d1")?.href).toBeUndefined();
    expect(g.nodes.find((n) => n.id === "term:t1")?.href).toBeUndefined();
  });

  it("restricts people to lab members via the daliMember filter", async () => {
    await buildGlobalGraph(prisma as never);
    expect(mockPrisma.user!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { daliMember: { isNot: null } } }),
    );
  });
});

describe("buildGlobalGraph — edges", () => {
  it("maps join rows to edges between the right node ids", async () => {
    mockPrisma.project!.findMany.mockResolvedValue([{ id: "p1", name: "Alpha" }]);
    mockPrisma.user!.findMany.mockResolvedValue([
      U("u1", "Ada", "Lovelace"),
      U("u2", "Grace", "Hopper"),
    ]);
    mockPrisma.domain!.findMany.mockResolvedValue([D("d1", "Fullstack")]);

    mockPrisma.projectDomain!.findMany.mockResolvedValue([{ projectId: "p1", domainId: "d1" }]);
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([{ userId: "u1", projectId: "p1" }]);
    mockPrisma.domainEligibility!.findMany.mockResolvedValue([{ userId: "u1", domainId: "d1" }]);
    mockPrisma.mentorshipPair!.findMany.mockResolvedValue([
      { mentorUserId: "u1", menteeUserId: "u2" },
    ]);

    const g = await buildGlobalGraph(prisma as never);

    expect(edgesOfType(g, "declares_domain")[0]).toMatchObject({
      source: "project:p1",
      target: "domain:d1",
    });
    expect(edgesOfType(g, "assigned_to")[0]).toMatchObject({
      source: "person:u1",
      target: "project:p1",
    });
    expect(edgesOfType(g, "eligible_in")[0]).toMatchObject({
      source: "person:u1",
      target: "domain:d1",
    });
    expect(edgesOfType(g, "mentors")[0]).toMatchObject({
      source: "person:u1",
      target: "person:u2",
    });
  });

  it("drops edges whose endpoint node was filtered out (e.g. a non-member user)", async () => {
    mockPrisma.project!.findMany.mockResolvedValue([{ id: "p1", name: "Alpha" }]);
    // No users returned (e.g. an applicant assignee that isn't a member).
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([{ userId: "ghost", projectId: "p1" }]);

    const g = await buildGlobalGraph(prisma as never);

    expect(edgesOfType(g, "assigned_to")).toHaveLength(0);
    expect(nodeIds(g, "person")).toHaveLength(0);
  });

  it("links a task to its most specific parent (sprint over epic over project)", async () => {
    mockPrisma.project!.findMany.mockResolvedValue([{ id: "p1", name: "Alpha" }]);
    mockPrisma.epic!.findMany.mockResolvedValue([{ id: "e1", title: "Epic", projectId: "p1" }]);
    mockPrisma.sprint!.findMany.mockResolvedValue([
      { id: "s1", name: "Sprint 1", projectId: "p1", epicId: "e1" },
    ]);
    mockPrisma.task!.findMany.mockResolvedValue([
      { id: "ta", title: "In sprint", projectId: "p1", epicId: "e1", sprintId: "s1" },
      { id: "tb", title: "In epic", projectId: "p1", epicId: "e1", sprintId: null },
      { id: "tc", title: "Loose", projectId: "p1", epicId: null, sprintId: null },
    ]);

    const g = await buildGlobalGraph(prisma as never);

    expect(edgesOfType(g, "task_in_sprint")).toEqual([
      expect.objectContaining({ source: "task:ta", target: "sprint:s1" }),
    ]);
    expect(edgesOfType(g, "task_in_epic")).toEqual([
      expect.objectContaining({ source: "task:tb", target: "epic:e1" }),
    ]);
    expect(edgesOfType(g, "task_in_project")).toEqual([
      expect.objectContaining({ source: "task:tc", target: "project:p1" }),
    ]);
    // sprint → project and sprint → epic both drawn
    expect(edgesOfType(g, "sprint_in_project")).toHaveLength(1);
    expect(edgesOfType(g, "sprint_in_epic")).toHaveLength(1);
    expect(edgesOfType(g, "epic_in_project")).toHaveLength(1);
  });

  it("links documents and files to their project", async () => {
    mockPrisma.project!.findMany.mockResolvedValue([{ id: "p1", name: "Alpha" }]);
    mockPrisma.page!.findMany.mockResolvedValue([
      { id: "pg1", title: "Spec", workspaceId: "p1" },
      { id: "pg2", title: "Orphan", workspaceId: null },
    ]);
    mockPrisma.projectFile!.findMany.mockResolvedValue([
      { id: "f1", title: "deck.pdf", projectId: "p1" },
    ]);

    const g = await buildGlobalGraph(prisma as never);

    expect(edgesOfType(g, "doc_in_project")).toEqual([
      expect.objectContaining({ source: "document:pg1", target: "project:p1" }),
    ]);
    expect(edgesOfType(g, "file_in_project")).toEqual([
      expect.objectContaining({ source: "file:f1", target: "project:p1" }),
    ]);
    // both pages still exist as nodes, with hrefs
    expect(g.nodes.find((n) => n.id === "document:pg1")?.href).toBe("/documents/pg1");
    expect(g.nodes.find((n) => n.id === "file:f1")?.href).toBe("/documents/file/f1");
  });

  it("de-dupes an edge reached identically twice", async () => {
    mockPrisma.project!.findMany.mockResolvedValue([{ id: "p1", name: "Alpha" }]);
    mockPrisma.domain!.findMany.mockResolvedValue([D("d1", "Fullstack")]);
    mockPrisma.projectDomain!.findMany.mockResolvedValue([
      { projectId: "p1", domainId: "d1" },
      { projectId: "p1", domainId: "d1" },
    ]);

    const g = await buildGlobalGraph(prisma as never);
    expect(edgesOfType(g, "declares_domain")).toHaveLength(1);
  });

  it("scopes term-bound joins to the given termId", async () => {
    await buildGlobalGraph(prisma as never, { termId: "t9" });
    expect(mockPrisma.projectAssignment!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { termId: "t9" } }),
    );
    expect(mockPrisma.staffingAssignment!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { termId: "t9" } }),
    );
  });
});
