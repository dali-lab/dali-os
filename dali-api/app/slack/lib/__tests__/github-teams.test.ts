import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ensureTeam,
  addTeamMember,
  grantTeamRepo,
  __setGitHubClientForTests,
} from "~/lib/github";
import type { Octokit } from "@octokit/rest";

// Minimal fake of the Octokit surface the team helpers touch.
function fakeOctokit(overrides: {
  getByName?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  addMembership?: ReturnType<typeof vi.fn>;
  grantRepo?: ReturnType<typeof vi.fn>;
}) {
  return {
    rest: {
      teams: {
        getByName: overrides.getByName ?? vi.fn(),
        create: overrides.create ?? vi.fn(),
        addOrUpdateMembershipForUserInOrg: overrides.addMembership ?? vi.fn(),
        addOrUpdateRepoPermissionsInOrg: overrides.grantRepo ?? vi.fn(),
      },
    },
  } as unknown as Octokit;
}

const notFound = Object.assign(new Error("Not Found"), { status: 404 });

beforeEach(() => {
  process.env.GITHUB_ORG = "dali-test-org";
});
afterEach(() => {
  __setGitHubClientForTests(null);
  delete process.env.GITHUB_ORG;
});

describe("ensureTeam", () => {
  it("returns an existing team without recreating it (idempotent re-run)", async () => {
    const getByName = vi.fn().mockResolvedValue({ data: { slug: "alpha" } });
    const create = vi.fn();
    __setGitHubClientForTests(fakeOctokit({ getByName, create }));

    const res = await ensureTeam("alpha");
    expect(res).toEqual({ slug: "alpha", created: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a closed team when none exists (404 → create)", async () => {
    const getByName = vi.fn().mockRejectedValue(notFound);
    const create = vi.fn().mockResolvedValue({ data: { slug: "beta" } });
    __setGitHubClientForTests(fakeOctokit({ getByName, create }));

    const res = await ensureTeam("beta");
    expect(res).toEqual({ slug: "beta", created: true });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ org: "dali-test-org", name: "beta", privacy: "closed" }),
    );
  });

  it("propagates non-404 errors instead of creating", async () => {
    const getByName = vi.fn().mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500 }),
    );
    const create = vi.fn();
    __setGitHubClientForTests(fakeOctokit({ getByName, create }));

    await expect(ensureTeam("gamma")).rejects.toThrow("boom");
    expect(create).not.toHaveBeenCalled();
  });

  it("throws when GITHUB_ORG is unset", async () => {
    delete process.env.GITHUB_ORG;
    __setGitHubClientForTests(fakeOctokit({}));
    await expect(ensureTeam("delta")).rejects.toThrow("GITHUB_ORG");
  });
});

describe("addTeamMember", () => {
  it("adds a member with role 'member' (PUT is idempotent)", async () => {
    const addMembership = vi.fn().mockResolvedValue({});
    __setGitHubClientForTests(fakeOctokit({ addMembership }));

    const res = await addTeamMember("alpha", "octocat");
    expect(addMembership).toHaveBeenCalledWith({
      org: "dali-test-org",
      team_slug: "alpha",
      username: "octocat",
      role: "member",
    });
    // No data.state on the response → defaults to "active" (backward-compatible).
    expect(res).toEqual({ state: "active" });
  });

  it("reports state:'pending' when the user isn't yet an org member", async () => {
    const addMembership = vi.fn().mockResolvedValue({ data: { state: "pending" } });
    __setGitHubClientForTests(fakeOctokit({ addMembership }));
    expect(await addTeamMember("alpha", "invitee")).toEqual({ state: "pending" });
  });

  it("reports state:'active' for an accepted membership", async () => {
    const addMembership = vi.fn().mockResolvedValue({ data: { state: "active" } });
    __setGitHubClientForTests(fakeOctokit({ addMembership }));
    expect(await addTeamMember("alpha", "member")).toEqual({ state: "active" });
  });
});

describe("grantTeamRepo", () => {
  it("grants push by default with the right params", async () => {
    const grantRepo = vi.fn().mockResolvedValue({});
    __setGitHubClientForTests(fakeOctokit({ grantRepo }));

    await grantTeamRepo("alpha", "dali-lab", "foo");
    expect(grantRepo).toHaveBeenCalledWith({
      org: "dali-test-org",
      team_slug: "alpha",
      owner: "dali-lab",
      repo: "foo",
      permission: "push",
    });
  });

  it("honors an explicit permission", async () => {
    const grantRepo = vi.fn().mockResolvedValue({});
    __setGitHubClientForTests(fakeOctokit({ grantRepo }));

    await grantTeamRepo("alpha", "dali-lab", "bar", "admin");
    expect(grantRepo).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "dali-lab", repo: "bar", permission: "admin" }),
    );
  });

  it("throws when GITHUB_ORG is unset", async () => {
    delete process.env.GITHUB_ORG;
    __setGitHubClientForTests(fakeOctokit({}));
    await expect(grantTeamRepo("alpha", "dali-lab", "foo")).rejects.toThrow("GITHUB_ORG");
  });

  it("propagates a 404 (missing repo/team)", async () => {
    const grantRepo = vi.fn().mockRejectedValue(notFound);
    __setGitHubClientForTests(fakeOctokit({ grantRepo }));
    await expect(grantTeamRepo("alpha", "dali-lab", "nope")).rejects.toBe(notFound);
  });
});
