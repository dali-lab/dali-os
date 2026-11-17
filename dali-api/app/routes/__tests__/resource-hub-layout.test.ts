import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    resourceHubPage: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    domainLeadAssignment: { findFirst: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(), getUserRoles: vi.fn(), isCore: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectPartnerToPortal: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/components/doc", () => ({ uploadEditorImage: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { currentTerm, getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isNonMember, redirectPartnerToPortal, requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { action, loader } from "../resource-hub-layout";

const db = vi.mocked(prisma, true);
const params = { pageId: "p1" };
const page = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  title: "Design",
  coverUrl: "pattern:petal-ledger?d=frame&c=plum",
  publishedAt: new Date(0),
  domainId: "d1",
  createdById: "u9",
  domain: { displayName: "Design" },
  ...over,
});
const get = () => loader({ request: new Request("http://localhost/resource-hub/p1"), params, context: {} } as never) as Promise<any>;
const post = (fields: Record<string, string>) => {
  const body = new FormData();
  Object.entries(fields).forEach(([k, v]) => body.set(k, v));
  return action({ request: new Request("http://localhost/resource-hub/p1", { method: "POST", body }), params, context: {} } as never) as Promise<any>;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1", email: "ada@example.edu", firstName: "Ada", lastName: "Lovelace" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(redirectPartnerToPortal).mockResolvedValue(null as never);
  vi.mocked(getUserRoles).mockResolvedValue([] as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(currentTerm).mockResolvedValue({ id: "t1" } as never);
  db.domainLeadAssignment.findFirst.mockResolvedValue(null);
  db.resourceHubPage.findUnique.mockResolvedValue(page() as never);
  db.resourceHubPage.update.mockResolvedValue({} as never);
});

describe("loader", () => {
  it("hands the hub page the hub's title, cover, domain and whether the viewer can edit", async () => {
    expect(await get()).toEqual({
      hub: { id: "p1", title: "Design", coverUrl: "pattern:petal-ledger?d=frame&c=plum", published: true, domainName: "Design" },
      canEdit: false,
    });
  });

  it("marks a lead of the hub's domain as an editor", async () => {
    db.domainLeadAssignment.findFirst.mockResolvedValue({ id: "a1" } as never);
    expect((await get()).canEdit).toBe(true);
  });

  it("404s a draft for someone who can't edit it and shows it to its creator", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(page({ publishedAt: null }) as never);
    await expect(get()).rejects.toMatchObject({ status: 404 });
    db.resourceHubPage.findUnique.mockResolvedValue(page({ publishedAt: null, createdById: "u1" }) as never);
    expect(await get()).toMatchObject({ hub: { published: false }, canEdit: true });
  });

  it("404s a hub that doesn't exist", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(null);
    await expect(get()).rejects.toMatchObject({ status: 404 });
    expect(db.resourceHubPage.findFirst).not.toHaveBeenCalled();
  });
});

describe("banner action", () => {
  beforeEach(() => db.resourceHubPage.findUnique.mockResolvedValue(page({ createdById: "u1" }) as never));

  it("saves the title and cover for an editor", async () => {
    expect(await post({ intent: "banner", title: "  Design   studio ", url: "pattern:orbit-field" })).toEqual({ ok: true });
    expect(db.resourceHubPage.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { title: "Design studio", coverUrl: "pattern:orbit-field" } });
  });

  it("keeps a stored legacy cover with a decor query valid", async () => {
    await post({ intent: "banner", title: "Design", url: "pattern:petal-ledger?d=frame,seal&c=plum" });
    expect(db.resourceHubPage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ coverUrl: "pattern:petal-ledger?d=frame,seal&c=plum" }) }));
  });

  it("accepts an uploaded image and clears the cover on an empty url", async () => {
    await post({ intent: "banner", title: "Design", url: "/api/upload/raw?key=uploads%2Fa.webp" });
    expect(db.resourceHubPage.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { title: "Design", coverUrl: "/api/upload/raw?key=uploads%2Fa.webp" } }));
    await post({ intent: "banner", title: "Design", url: "" });
    expect(db.resourceHubPage.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { title: "Design", coverUrl: null } }));
  });

  it("rejects a blank title and an arbitrary image url", async () => {
    const blank = await post({ intent: "banner", title: "  ", url: "" });
    expect(blank.status).toBe(400);
    const bad = await post({ intent: "banner", title: "Design", url: "https://example.com/a.png" });
    expect(bad.status).toBe(400);
    expect(db.resourceHubPage.update).not.toHaveBeenCalled();
  });

  it("refuses anyone who can't edit the hub", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(page() as never);
    await expect(post({ intent: "banner", title: "Hacked", url: "" })).rejects.toMatchObject({ status: 403 });
    expect(db.resourceHubPage.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    await expect(post({ intent: "title", title: "x" })).rejects.toMatchObject({ status: 400 });
  });
});
