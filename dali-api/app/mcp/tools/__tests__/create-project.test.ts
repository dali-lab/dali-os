import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/lib/groups", () => ({ ensureProjectGroup: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { ensureProjectGroup } from "~/lib/groups";
import {
  runCreateProject,
  CREATE_PROJECT_TOOL,
  CreateProjectError,
} from "~/mcp/tools/create-project";

const mockPrisma = prisma as unknown as {
  project: { create: ReturnType<typeof vi.fn> };
  term: { findMany: ReturnType<typeof vi.fn> };
  domain: { findMany: ReturnType<typeof vi.fn> };
  partnerOrg: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  (isCore as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  mockPrisma.project.create.mockResolvedValue({ id: "p1", name: "Alpha" });
  mockPrisma.term.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
  mockPrisma.domain.findMany.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
  mockPrisma.partnerOrg.findUnique.mockResolvedValue({ id: "org1" });
});

function data() {
  return mockPrisma.project.create.mock.calls[0][0].data;
}

describe("create_project", () => {
  it("advertises write scope", () => {
    expect(CREATE_PROJECT_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects a non-Core caller before touching the database", async () => {
    (isCore as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(runCreateProject("u1", { name: "Alpha" })).rejects.toThrow(
      CreateProjectError,
    );
    expect(mockPrisma.project.create).not.toHaveBeenCalled();
  });

  it("creates a minimal project and its group", async () => {
    const result = await runCreateProject("u1", { name: "  Alpha  " });

    expect(data()).toMatchObject({
      name: "Alpha",
      description: null,
      iconEmoji: null,
      status: "Active",
      termCount: 1,
    });
    expect(ensureProjectGroup).toHaveBeenCalledWith("p1", "Alpha");
    expect(result).toEqual({
      id: "p1",
      name: "Alpha",
      termCount: 0,
      domainCount: 0,
      challengeCount: 0,
    });
  });

  it("derives the github team slug from the name", async () => {
    await runCreateProject("u1", { name: "Project Alpha" });
    expect(data().githubTeamSlug).toBe("project-alpha");
  });

  it("seeds terms, domains, challenges, and a partner", async () => {
    await runCreateProject("u1", {
      name: "Alpha",
      description: "A blurb.",
      termIds: ["t1", "t2"],
      domainIds: ["d1"],
      challenges: [{ domainId: "d1", termId: "t1", scope: "Ship it" }],
      partnerOrgId: "org1",
    });

    const d = data();
    expect(d.description).toBe("A blurb.");
    expect(d.termCount).toBe(2);
    expect(d.projectTerms.create).toEqual([{ termId: "t1" }, { termId: "t2" }]);
    expect(d.domains.create).toEqual([{ domainId: "d1" }]);
    expect(d.domainScopes.create).toEqual([
      { domainId: "d1", termId: "t1", scope: "Ship it", updatedById: "u1" },
    ]);
    expect(d.partners.create).toEqual({ partnerOrgId: "org1" });
  });

  it("honours an explicit termCount over the derived one", async () => {
    await runCreateProject("u1", {
      name: "Alpha",
      termIds: ["t1"],
      termCount: 3,
    });
    expect(data().termCount).toBe(3);
  });

  it("dedupes repeated term and domain ids", async () => {
    await runCreateProject("u1", {
      name: "Alpha",
      termIds: ["t1", "t1"],
      domainIds: ["d1", "d1"],
    });
    expect(data().projectTerms.create).toEqual([{ termId: "t1" }]);
    expect(data().domains.create).toEqual([{ domainId: "d1" }]);
  });

  it("rejects an unknown term", async () => {
    mockPrisma.term.findMany.mockResolvedValue([{ id: "t1" }]);
    await expect(
      runCreateProject("u1", { name: "Alpha", termIds: ["t1", "nope"] }),
    ).rejects.toThrow(/Unknown term\(s\): nope/);
    expect(mockPrisma.project.create).not.toHaveBeenCalled();
  });

  it("rejects an inactive or unknown domain", async () => {
    mockPrisma.domain.findMany.mockResolvedValue([]);
    await expect(
      runCreateProject("u1", { name: "Alpha", domainIds: ["d9"] }),
    ).rejects.toThrow(/Unknown or inactive domain\(s\): d9/);
  });

  it("rejects a challenge outside the declared domains", async () => {
    await expect(
      runCreateProject("u1", {
        name: "Alpha",
        termIds: ["t1"],
        domainIds: ["d1"],
        challenges: [{ domainId: "d2", termId: "t1", scope: "x" }],
      }),
    ).rejects.toThrow(/domainId d2 is not in domainIds/);
  });

  it("rejects a challenge outside the planned terms", async () => {
    await expect(
      runCreateProject("u1", {
        name: "Alpha",
        termIds: ["t1"],
        domainIds: ["d1"],
        challenges: [{ domainId: "d1", termId: "t2", scope: "x" }],
      }),
    ).rejects.toThrow(/termId t2 is not in termIds/);
  });

  it("rejects two challenges for the same cell", async () => {
    await expect(
      runCreateProject("u1", {
        name: "Alpha",
        termIds: ["t1"],
        domainIds: ["d1"],
        challenges: [
          { domainId: "d1", termId: "t1", scope: "first" },
          { domainId: "d1", termId: "t1", scope: "second" },
        ],
      }),
    ).rejects.toThrow(/Duplicate challenge/);
  });

  it("rejects an unknown partner org", async () => {
    mockPrisma.partnerOrg.findUnique.mockResolvedValue(null);
    await expect(
      runCreateProject("u1", { name: "Alpha", partnerOrgId: "nope" }),
    ).rejects.toThrow(/Unknown partnerOrgId/);
  });

  it("rejects a blank name", async () => {
    await expect(runCreateProject("u1", { name: "   " })).rejects.toThrow(
      /Name is required/,
    );
  });
});
