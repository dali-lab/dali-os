import { describe, it, expect, beforeEach, vi } from "vitest";

const getUserRoles = vi.hoisted(() => vi.fn());
vi.mock("~/lib/roles", () => ({ getUserRoles }));

import { runWhoami, WHOAMI_TOOL } from "~/mcp/tools/whoami";

const USER = {
  id: "u1",
  daliEmail: "ada@dali.example.edu",
  dartmouthEmail: "ada@example.edu",
  netId: "f00001",
  firstName: "Ada",
  lastName: "Lovelace",
};

const NO_ROLES = { isAdmin: false, isCore: false, isDomainLead: false, isLabMember: false };

beforeEach(() => vi.clearAllMocks());

describe("whoami", () => {
  it("scope is read", () => {
    expect(WHOAMI_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns the caller's identity without the Dartmouth email", async () => {
    getUserRoles.mockResolvedValue({ ...NO_ROLES, isLabMember: true });
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
    [{ isAdmin: true, isCore: true, isDomainLead: true, isLabMember: true }, "admin"],
    [{ isCore: true, isDomainLead: true, isLabMember: true }, "core"],
    [{ isDomainLead: true, isLabMember: true }, "domain-lead"],
    [{ isLabMember: true }, "member"],
    [{}, "non-member"],
  ])("reports the highest tier for %o as %s", async (roles, tier) => {
    getUserRoles.mockResolvedValue({ ...NO_ROLES, ...roles });
    expect((await runWhoami(USER)).tier).toBe(tier);
  });
});
