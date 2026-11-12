import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/betterauth-compat.server", () => ({ resolveBetterAuthAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  getUserRoles: vi.fn(),
  isCore: vi.fn(),
  isLabMember: vi.fn(),
  isProjectMember: vi.fn(),
}));

import { requireCore, requireCoreOrDomainLead } from "~/lib/auth";
import { resolveBetterAuthAuth } from "~/lib/betterauth-compat.server";
import { getUserRoles, isCore } from "~/lib/roles";

const rolesOf = (over: Record<string, boolean>) =>
  ({ isCore: false, isDomainLead: false, ...over }) as Awaited<ReturnType<typeof getUserRoles>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveBetterAuthAuth).mockResolvedValue({
    user: { sub: "ada", email: "ada@example.edu", type: "member" },
    sessionId: "s1",
  } as never);
});

describe("requireCore", () => {
  it("passes the request to the role check so it shares the per-request memo", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const req = new Request("http://localhost/x");
    const res = await requireCore(req);
    expect(res.ok).toBe(true);
    expect(isCore).toHaveBeenCalledWith("ada", req);
  });

  it("denies a user who is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await requireCore(new Request("http://localhost/x"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });
});

describe("requireCoreOrDomainLead", () => {
  it("reads roles once with the request", async () => {
    vi.mocked(getUserRoles).mockResolvedValue(rolesOf({ isCore: true }));
    const req = new Request("http://localhost/x");
    const res = await requireCoreOrDomainLead(req);
    expect(res.ok).toBe(true);
    expect(getUserRoles).toHaveBeenCalledTimes(1);
    expect(getUserRoles).toHaveBeenCalledWith("ada", req);
  });

  it("allows a domain lead who is not Core", async () => {
    vi.mocked(getUserRoles).mockResolvedValue(rolesOf({ isDomainLead: true }));
    const res = await requireCoreOrDomainLead(new Request("http://localhost/x"));
    expect(res.ok).toBe(true);
  });

  it("denies someone who is neither", async () => {
    vi.mocked(getUserRoles).mockResolvedValue(rolesOf({}));
    const res = await requireCoreOrDomainLead(new Request("http://localhost/x"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });
});
