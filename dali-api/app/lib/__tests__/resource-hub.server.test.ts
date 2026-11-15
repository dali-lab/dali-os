import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { domain: { findMany: vi.fn() }, domainLeadAssignment: { findMany: vi.fn(), findFirst: vi.fn() } },
}));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(), getUserRoles: vi.fn(), isCore: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectPartnerToPortal: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { hubDomainOptions } from "../resource-hub.server";

const db = vi.mocked(prisma, true);
const row = (id: string, displayName: string, hub: boolean) => ({ id, displayName, resourceHubPage: hub ? { id: `p-${id}` } : null });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(currentTerm).mockResolvedValue({ id: "t1" } as any);
});

describe("hubDomainOptions", () => {
  it("offers every active domain to Core and flags the ones that already have a hub", async () => {
    db.domain.findMany.mockResolvedValue([row("d1", "Design", true), row("d2", "Fullstack", false)] as any);
    expect(await hubDomainOptions("u1", true)).toEqual([
      { id: "d1", name: "Design", taken: true },
      { id: "d2", name: "Fullstack", taken: false },
    ]);
    expect(db.domain.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true, isSystem: false } }));
    expect(db.domainLeadAssignment.findMany).not.toHaveBeenCalled();
  });

  it("limits a lead to the domains they lead this term", async () => {
    db.domainLeadAssignment.findMany.mockResolvedValue([{ domainId: "d2" }] as any);
    db.domain.findMany.mockResolvedValue([row("d2", "Fullstack", false)] as any);
    expect(await hubDomainOptions("u1", false)).toEqual([{ id: "d2", name: "Fullstack", taken: false }]);
    expect(db.domainLeadAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1", termId: "t1" } }));
    expect(db.domain.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true, isSystem: false, id: { in: ["d2"] } } }));
  });

  it("offers nothing to someone who leads no domain", async () => {
    db.domainLeadAssignment.findMany.mockResolvedValue([]);
    expect(await hubDomainOptions("u1", false)).toEqual([]);
    expect(db.domain.findMany).not.toHaveBeenCalled();
  });
});
