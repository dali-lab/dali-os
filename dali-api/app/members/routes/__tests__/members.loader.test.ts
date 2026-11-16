import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    user: { findMany: vi.fn().mockResolvedValue([]) },
    domain: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({ ok: true, user: { sub: "viewer" } }),
  redirectNonMemberToPortal: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn().mockResolvedValue(false) }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/members/lib/membership.server", () => ({
  createOrPromoteMember: vi.fn(),
  MemberInputError: class extends Error {},
  PROFILE_TEXT_FIELDS: [],
}));

import { prisma } from "~/lib/db.server";
import { loader } from "~/members/routes/members";

describe("members loader", () => {
  it("leaves the Legacy history bucket out of the Domain filter", async () => {
    await loader({ request: new Request("http://x/members") } as never);
    const args = vi.mocked(prisma.user.findMany).mock.calls[0][0] as {
      select: { domainEligibilities: { where: unknown } };
    };
    expect(args.select.domainEligibilities.where).toEqual({ domainId: { not: "domain_legacy" } });
  });
});
