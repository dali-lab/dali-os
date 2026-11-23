import { describe, it, expect, beforeEach, vi } from "vitest";

const getUserRoles = vi.hoisted(() => vi.fn());
vi.mock("~/lib/roles", () => ({ getUserRoles }));
const runListMyRoles = vi.hoisted(() => vi.fn());
vi.mock("../time-entries", () => ({ runListMyRoles }));

import { runWhoami, WHOAMI_TOOL } from "~/mcp/tools/whoami";

const USER = {
  id: "u1",
  daliEmail: "ada@dali.example.edu",
  dartmouthEmail: "ada@example.edu",
  netId: "f00001",
  firstName: "Ada",
  lastName: "Lovelace",
};

const NO_ROLES = { isAdmin: false, isCore: false, isDomainLead: false, isLabMemberOrAlum: false };

beforeEach(() => vi.clearAllMocks());

describe("whoami", () => {
  it("scope is read", () => {
    expect(WHOAMI_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns the caller's identity without the Dartmouth email", async () => {
    getUserRoles.mockResolvedValue({ ...NO_ROLES, isLabMemberOrAlum: true });
    expect(await runWhoami(USER)).toEqual({
      id: "u1",
      daliEmail: "ada@dali.example.edu",
      netId: "f00001",
      firstName: "Ada",
      lastName: "Lovelace",
      tier: "member",
    });
    expect(getUserRoles).toHaveBeenCalledWith("u1");
  });

  it.each([
    [{ isAdmin: true, isCore: true, isDomainLead: true, isLabMemberOrAlum: true }, "admin"],
    [{ isCore: true, isDomainLead: true, isLabMemberOrAlum: true }, "core"],
    [{ isDomainLead: true, isLabMemberOrAlum: true }, "domain-lead"],
    [{ isLabMemberOrAlum: true }, "member"],
    [{}, "non-member"],
  ])("reports the highest tier for %o as %s", async (roles, tier) => {
    getUserRoles.mockResolvedValue({ ...NO_ROLES, ...roles });
    expect((await runWhoami(USER)).tier).toBe(tier);
  });

  it("leaves roles out unless asked", async () => {
    getUserRoles.mockResolvedValue(NO_ROLES);
    expect(await runWhoami(USER, { allTerms: true })).not.toHaveProperty("roles");
    expect(runListMyRoles).not.toHaveBeenCalled();
  });

  it("adds the caller's paid roles with includeRoles, current term by default", async () => {
    getUserRoles.mockResolvedValue({ ...NO_ROLES, isLabMemberOrAlum: true });
    runListMyRoles.mockResolvedValue({ roles: [{ assignmentType: "Project", roleRefId: "a1" }] });
    const out = await runWhoami(USER, { includeRoles: true });
    expect(out).toMatchObject({ id: "u1", tier: "member", roles: [{ assignmentType: "Project", roleRefId: "a1" }] });
    expect(runListMyRoles).toHaveBeenCalledWith("u1", { allTerms: undefined });
  });

  it("passes allTerms through to the roles lookup", async () => {
    getUserRoles.mockResolvedValue(NO_ROLES);
    runListMyRoles.mockResolvedValue({ roles: [] });
    await runWhoami(USER, { includeRoles: true, allTerms: true });
    expect(runListMyRoles).toHaveBeenCalledWith("u1", { allTerms: true });
  });
});
