import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { __setGitHubClientForTests } from "~/lib/github";
import { syncProjectTeam } from "~/projects/lib/github-team-sync";
import type { Octokit } from "@octokit/rest";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
};

const TERM = "term-26x";
const notFound = Object.assign(new Error("Not Found"), { status: 404 });

function fakeOctokit(o: {
  getByName?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  addMembership?: ReturnType<typeof vi.fn>;
  grantRepo?: ReturnType<typeof vi.fn>;
}) {
  return {
    rest: {
      teams: {
        getByName: o.getByName ?? vi.fn().mockResolvedValue({ data: { slug: "proj" } }),
        create: o.create ?? vi.fn().mockResolvedValue({ data: { slug: "proj" } }),
        addOrUpdateMembershipForUserInOrg:
          o.addMembership ?? vi.fn().mockResolvedValue({ data: { state: "active" } }),
        addOrUpdateRepoPermissionsInOrg: o.grantRepo ?? vi.fn().mockResolvedValue({}),
      },
    },
  } as unknown as Octokit;
}

function assignment(id: string, first: string, last: string, gh: string | null) {
  return { user: { id, firstName: first, lastName: last, githubUsername: gh } };
}

function projectRow(over: Partial<{ githubTeamSlug: string | null; repoUrls: string[]; assignments: unknown[] }> = {}) {
  return {
    id: "p1",
    name: "Proj",
    githubTeamSlug: "proj",
    repoUrls: [],
    assignments: [],
    ...over,
  };
}

beforeEach(() => {
  process.env.GITHUB_ORG = "dali-test-org";
  mockPrisma.project = { findUnique: vi.fn() };
});
afterEach(() => {
  __setGitHubClientForTests(null);
  delete process.env.GITHUB_ORG;
  vi.clearAllMocks();
});

describe("syncProjectTeam", () => {
  it("happy path: ensures team, adds handles (active + pending), grants parseable repos, reports missing", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(
      projectRow({
        repoUrls: ["https://github.com/dali-lab/foo", "dali-lab/bar", "garbage"],
        assignments: [
          assignment("u1", "Ada", "Byte", "ada"),
          assignment("u2", "Grace", "Hop", "gracep"),
          assignment("u3", "No", "Handle", null),
        ],
      }),
    );
    const addMembership = vi.fn().mockImplementation(({ username }: { username: string }) =>
      Promise.resolve({ data: { state: username === "gracep" ? "pending" : "active" } }),
    );
    const grantRepo = vi.fn().mockResolvedValue({});
    __setGitHubClientForTests(fakeOctokit({ addMembership, grantRepo }));

    const r = await syncProjectTeam("p1", TERM);

    expect(r.status).toBe("ok");
    expect(r.teamCreated).toBe(false);
    expect(r.membersEnsured).toBe(2);
    expect(r.membersPending).toBe(1);
    expect(r.missingHandles).toEqual(["No Handle"]);
    expect(addMembership).toHaveBeenCalledTimes(2);
    // parseable repos granted with push, garbage skipped (not an error).
    expect(grantRepo).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "dali-lab", repo: "foo", permission: "push" }),
    );
    expect(grantRepo).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "dali-lab", repo: "bar", permission: "push" }),
    );
    expect(grantRepo).toHaveBeenCalledTimes(2);
    expect(r.repos.find((x) => x.repo === "garbage")?.status).toBe("skipped");
  });

  it("dedupes a member assigned in two domains to a single membership PUT", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(
      projectRow({
        assignments: [assignment("u1", "Ada", "Byte", "ada"), assignment("u1", "Ada", "Byte", "ada")],
      }),
    );
    const addMembership = vi.fn().mockResolvedValue({ data: { state: "active" } });
    __setGitHubClientForTests(fakeOctokit({ addMembership }));

    const r = await syncProjectTeam("p1", TERM);
    expect(addMembership).toHaveBeenCalledTimes(1);
    expect(r.membersEnsured).toBe(1);
  });

  it("skips (no octokit calls) when the project has no slug", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(projectRow({ githubTeamSlug: null }));
    const getByName = vi.fn();
    const addMembership = vi.fn();
    __setGitHubClientForTests(fakeOctokit({ getByName, addMembership }));

    const r = await syncProjectTeam("p1", TERM);
    expect(r.status).toBe("skipped");
    expect(getByName).not.toHaveBeenCalled();
    expect(addMembership).not.toHaveBeenCalled();
  });

  it("errors (no member/repo calls) when ensureTeam fails", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(
      projectRow({
        repoUrls: ["dali-lab/foo"],
        assignments: [assignment("u1", "Ada", "Byte", "ada")],
      }),
    );
    const getByName = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const addMembership = vi.fn();
    const grantRepo = vi.fn();
    __setGitHubClientForTests(fakeOctokit({ getByName, addMembership, grantRepo }));

    const r = await syncProjectTeam("p1", TERM);
    expect(r.status).toBe("error");
    expect(addMembership).not.toHaveBeenCalled();
    expect(grantRepo).not.toHaveBeenCalled();
  });

  it("isolates a failing member add — other members still ensured, status error", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(
      projectRow({
        assignments: [assignment("u1", "A", "A", "aaa"), assignment("u2", "B", "B", "bbb")],
      }),
    );
    const addMembership = vi.fn().mockImplementation(({ username }: { username: string }) =>
      username === "aaa" ? Promise.reject(notFound) : Promise.resolve({ data: { state: "active" } }),
    );
    __setGitHubClientForTests(fakeOctokit({ addMembership }));

    const r = await syncProjectTeam("p1", TERM);
    expect(r.status).toBe("error");
    expect(r.memberErrors).toHaveLength(1);
    expect(r.memberErrors[0].handle).toBe("aaa");
    expect(r.membersEnsured).toBe(1);
  });

  it("isolates a failing repo grant — others granted, status error, actionable 404 message", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(
      projectRow({ repoUrls: ["dali-lab/ok", "dali-lab/missing"] }),
    );
    const grantRepo = vi.fn().mockImplementation(({ repo }: { repo: string }) =>
      repo === "missing" ? Promise.reject(notFound) : Promise.resolve({}),
    );
    __setGitHubClientForTests(fakeOctokit({ grantRepo }));

    const r = await syncProjectTeam("p1", TERM);
    expect(r.status).toBe("error");
    const bad = r.repos.find((x) => x.repo === "dali-lab/missing");
    expect(bad?.status).toBe("error");
    expect(bad?.message).toContain("not found");
    expect(r.repos.find((x) => x.repo === "dali-lab/ok")?.status).toBe("granted");
  });

  it("is idempotent on re-run: existing team, no create call", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(
      projectRow({ assignments: [assignment("u1", "A", "A", "aaa")] }),
    );
    const getByName = vi.fn().mockResolvedValue({ data: { slug: "proj" } });
    const create = vi.fn();
    __setGitHubClientForTests(fakeOctokit({ getByName, create }));

    const r = await syncProjectTeam("p1", TERM);
    expect(r.status).toBe("ok");
    expect(r.teamCreated).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("strips a stored leading '@' from a handle", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(
      projectRow({ assignments: [assignment("u1", "A", "A", "@ada")] }),
    );
    const addMembership = vi.fn().mockResolvedValue({ data: { state: "active" } });
    __setGitHubClientForTests(fakeOctokit({ addMembership }));

    await syncProjectTeam("p1", TERM);
    expect(addMembership).toHaveBeenCalledWith(expect.objectContaining({ username: "ada" }));
  });

  it("skips when the project is not found", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    __setGitHubClientForTests(fakeOctokit({}));

    const r = await syncProjectTeam("nope", TERM);
    expect(r.status).toBe("skipped");
    expect(r.message).toContain("not found");
  });
});
