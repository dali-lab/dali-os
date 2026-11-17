import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    resourceHubPage: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    collabDocument: { deleteMany: vi.fn() },
    domainLeadAssignment: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(), getUserRoles: vi.fn(), isCore: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectPartnerToPortal: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn() }));
vi.mock("~/lib/ai.server", () => ({ isAiEnabled: vi.fn() }));
vi.mock("~/components/doc", () => ({ DocEditor: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { currentTerm, getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isNonMember, redirectPartnerToPortal, requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { isAiEnabled } from "~/lib/ai.server";
import { action, loader } from "../resource-hub.$pageId";

const db = vi.mocked(prisma, true);
const params = { pageId: "p1" };
const page = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  title: "Design",
  coverUrl: null,
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
const asEditor = () => vi.mocked(isCore).mockResolvedValue(true);

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
  vi.mocked(getCollabToken).mockResolvedValue("tok" as never);
  vi.mocked(isAiEnabled).mockReturnValue(false);
  db.domainLeadAssignment.findFirst.mockResolvedValue(null);
  db.resourceHubPage.findUnique.mockResolvedValue(page() as never);
  db.resourceHubPage.update.mockResolvedValue({} as never);
  db.$transaction.mockResolvedValue([] as never);
});

describe("loader", () => {
  it("gives a published hub to a member without a collab token", async () => {
    db.resourceHubPage.findUnique.mockResolvedValueOnce(page() as never).mockResolvedValueOnce({ contentJson: [{ id: "b" }] } as never);
    const data = await get();
    expect(data.canEdit).toBe(false);
    expect(data.collabToken).toBeNull();
    expect(data.page).toEqual({ id: "p1", title: "Design", published: true, contentJson: [{ id: "b" }] });
  });

  it("gives an editor a collab token", async () => {
    asEditor();
    expect((await get()).collabToken).toBe("tok");
  });

  it("404s a draft for someone who can't edit it", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(page({ publishedAt: null }) as never);
    await expect(get()).rejects.toMatchObject({ status: 404 });
  });

  it("opens a draft for its creator", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(page({ publishedAt: null, createdById: "u1" }) as never);
    const data = await get();
    expect(data.canEdit).toBe(true);
    expect(data.page.published).toBe(false);
  });
});

describe("action", () => {
  it("refuses anyone who can't edit the hub", async () => {
    await expect(post({ intent: "publish", published: "1" })).rejects.toMatchObject({ status: 403 });
    await expect(post({ intent: "delete" })).rejects.toMatchObject({ status: 403 });
    expect(db.resourceHubPage.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("publishes", async () => {
    asEditor();
    expect(await post({ intent: "publish", published: "1" })).toEqual({ ok: true });
    const data = db.resourceHubPage.update.mock.calls[0]![0].data as { publishedAt: Date };
    expect(db.resourceHubPage.update.mock.calls[0]![0].where).toEqual({ id: "p1" });
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it("unpublishes", async () => {
    asEditor();
    expect(await post({ intent: "publish", published: "0" })).toEqual({ ok: true });
    expect(db.resourceHubPage.update.mock.calls[0]![0].data).toEqual({ publishedAt: null });
  });

  it("deletes the page and its collab document, then goes back to the list", async () => {
    asEditor();
    const res = await post({ intent: "delete" });
    expect(db.collabDocument.deleteMany).toHaveBeenCalledWith({ where: { name: "resourceHub:p1:body" } });
    expect(db.resourceHubPage.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/resource-hub");
  });

  it("rejects an unknown intent", async () => {
    asEditor();
    await expect(post({ intent: "nope" })).rejects.toMatchObject({ status: 400 });
  });
});
