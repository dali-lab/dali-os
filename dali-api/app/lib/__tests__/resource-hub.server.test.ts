import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { domain: { findMany: vi.fn() }, domainLeadAssignment: { findMany: vi.fn(), findFirst: vi.fn() }, resourceHubPage: { findFirst: vi.fn() } },
}));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(), getUserRoles: vi.fn(), isCore: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectPartnerToPortal: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { currentTerm, getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { hubDomainOptions, loadHubAccess, resourceHubViewer } from "../resource-hub.server";

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

describe("resourceHubViewer", () => {
  const set = (flag: boolean, member: boolean, core: boolean) => {
    vi.mocked(getUserRoles).mockResolvedValue({} as any);
    vi.mocked(isFeatureEnabled).mockResolvedValue(flag);
    vi.mocked(isLabMember).mockResolvedValue(member);
    vi.mocked(isCore).mockResolvedValue(core);
  };

  it("admits a lab member with the flag on", async () => {
    set(true, true, false);
    expect(await resourceHubViewer("u1")).toEqual({ core: false });
  });

  it("admits Core who is not a lab member", async () => {
    set(true, false, true);
    expect(await resourceHubViewer("u1")).toEqual({ core: true });
  });

  it("turns away everyone when the flag is off, and non-members when it is on", async () => {
    set(false, true, true);
    expect(await resourceHubViewer("u1")).toBeNull();
    set(true, false, false);
    expect(await resourceHubViewer("u1")).toBeNull();
  });
});

describe("loadHubAccess", () => {
  const hub = (over = {}) => ({ id: "h1", title: "Design", coverUrl: null, publishedAt: new Date(0), domainId: "d1", createdById: "x", domain: { displayName: "Design" }, ...over });
  const viewer = (core = false, member = true) => {
    vi.mocked(getUserRoles).mockResolvedValue({} as any);
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(isLabMember).mockResolvedValue(member);
    vi.mocked(isCore).mockResolvedValue(core);
  };

  it("is null without a hubId or domainId, without querying", async () => {
    viewer();
    expect(await loadHubAccess("u1", {})).toBeNull();
    expect(db.resourceHubPage.findFirst).not.toHaveBeenCalled();
  });

  it("is null when the flag is off or the caller is not a member", async () => {
    viewer(false, false);
    expect(await loadHubAccess("u1", { hubId: "h1" })).toBeNull();
    expect(db.resourceHubPage.findFirst).not.toHaveBeenCalled();
  });

  it("is null for a missing hub, and looks a hub up by domain", async () => {
    viewer();
    db.resourceHubPage.findFirst.mockResolvedValue(null);
    expect(await loadHubAccess("u1", { domainId: "d1" })).toBeNull();
    expect(db.resourceHubPage.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { domainId: "d1" } }));
  });

  it("hides a draft from a member who cannot edit it", async () => {
    viewer();
    db.resourceHubPage.findFirst.mockResolvedValue(hub({ publishedAt: null }) as any);
    db.domainLeadAssignment.findFirst.mockResolvedValue(null);
    vi.mocked(currentTerm).mockResolvedValue({ id: "t1" } as any);
    expect(await loadHubAccess("u1", { hubId: "h1" })).toBeNull();
  });

  it("shows a published hub read-only to a member", async () => {
    viewer();
    db.resourceHubPage.findFirst.mockResolvedValue(hub() as any);
    db.domainLeadAssignment.findFirst.mockResolvedValue(null);
    db.domainLeadAssignment.findMany.mockResolvedValue([]);
    vi.mocked(currentTerm).mockResolvedValue({ id: "t1" } as any);
    expect(await loadHubAccess("u1", { hubId: "h1" })).toMatchObject({ canEdit: false, canModerate: false, core: false, viewerId: "u1" });
  });

  it("lets a lead of the domain edit and moderate, even a draft", async () => {
    viewer();
    db.resourceHubPage.findFirst.mockResolvedValue(hub({ publishedAt: null }) as any);
    db.domainLeadAssignment.findFirst.mockResolvedValue({ id: "a1" } as any);
    db.domainLeadAssignment.findMany.mockResolvedValue([{ domainId: "d1" }] as any);
    vi.mocked(currentTerm).mockResolvedValue({ id: "t1" } as any);
    expect(await loadHubAccess("u1", { hubId: "h1" })).toMatchObject({ canEdit: true, canModerate: true });
  });

  it("lets Core edit and moderate any hub", async () => {
    viewer(true);
    db.resourceHubPage.findFirst.mockResolvedValue(hub({ publishedAt: null }) as any);
    expect(await loadHubAccess("u1", { hubId: "h1" })).toMatchObject({ canEdit: true, canModerate: true, core: true });
  });
});
