import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    resourceHubPage: { findUnique: vi.fn() },
    critSubmission: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    docComment: { groupBy: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/collabAuth.server", () => ({ hydrateAuthors: vi.fn() }));
vi.mock("~/lib/resource-hub.server", () => ({ canEditResourceHub: vi.fn(), ledDomainIds: vi.fn(), requireResourceHubViewer: vi.fn() }));
vi.mock("~/lib/link-preview.server", () => ({ fetchLinkPreview: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { canEditResourceHub, ledDomainIds, requireResourceHubViewer } from "~/lib/resource-hub.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";
import { hydrateAuthors } from "~/lib/collabAuth.server";
import { _resetForTests } from "~/lib/rate-limit";
import { action, loader } from "~/routes/resource-hub.$pageId.crit";

const db = vi.mocked(prisma, true);
const params = { pageId: "p1" };
const page = (publishedAt: Date | null) =>
  ({ id: "p1", domainId: "d1", createdById: "u9", title: "Design", coverUrl: null, publishedAt, domain: { displayName: "Design" } }) as any;

const post = (fields: Record<string, string>) => {
  const body = new FormData();
  Object.entries(fields).forEach(([k, v]) => body.set(k, v));
  return action({ request: new Request("http://localhost/resource-hub/p1/crit", { method: "POST", body }), params, context: {} } as any) as Promise<any>;
};
const get = () => loader({ request: new Request("http://localhost/resource-hub/p1/crit"), params, context: {} } as any) as Promise<any>;

beforeEach(() => {
  vi.resetAllMocks();
  _resetForTests();
  vi.mocked(requireResourceHubViewer).mockResolvedValue({ user: { sub: "u1" }, core: false, userName: "Ada Lovelace" } as any);
  vi.mocked(ledDomainIds).mockResolvedValue([]);
  vi.mocked(canEditResourceHub).mockResolvedValue(false);
  vi.mocked(fetchLinkPreview).mockResolvedValue({ title: "T", image: null, description: null });
  db.critSubmission.findMany.mockResolvedValue([]);
  db.docComment.groupBy.mockResolvedValue([]);
  db.$transaction.mockResolvedValue([]);
  vi.mocked(hydrateAuthors).mockResolvedValue([{ id: "u1", name: "Ada Lovelace", photoUrl: "/ada.png" }]);
});

describe("draft hub", () => {
  it("404s the loader and the action for someone who can't edit the hub", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(page(null));
    await expect(get()).rejects.toMatchObject({ status: 404 });
    await expect(post({ intent: "create", kind: "link", url: "https://example.com" })).rejects.toMatchObject({ status: 404 });
    expect(db.critSubmission.create).not.toHaveBeenCalled();
  });
  it("lets an editor through", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(page(null));
    vi.mocked(canEditResourceHub).mockResolvedValue(true);
    expect((await get()).hub.published).toBe(false);
  });
  it("lets any member into a published hub", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(page(new Date(0)));
    expect((await get()).hub.published).toBe(true);
    expect(canEditResourceHub).not.toHaveBeenCalled();
  });
});

describe("create", () => {
  it("rate limits link previews per user and skips the fetch", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(page(new Date(0)));
    for (let i = 0; i < 20; i++) await post({ intent: "create", kind: "link", url: "https://example.com" });
    vi.mocked(fetchLinkPreview).mockClear();
    const res = await post({ intent: "create", kind: "link", url: "https://example.com" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests" });
    expect(fetchLinkPreview).not.toHaveBeenCalled();
  });
});

describe("loader", () => {
  const row = (id: string, authorId = "u9") => ({ id, title: id, question: null, kind: "image", url: "/a.png", previewUrl: null, fileName: null, anonymous: false, authorId, author: { firstName: "A", lastName: "B" }, createdAt: new Date(0) });

  it("counts each post's comments from the shared comment table and names the viewer", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(page(new Date(0)));
    db.critSubmission.findMany.mockResolvedValue([row("s1"), row("s2")]);
    db.docComment.groupBy.mockResolvedValue([{ targetId: "s1", _count: { _all: 4 } }]);
    const out = await get();
    expect(db.docComment.groupBy.mock.calls[0][0].where).toEqual({ targetType: "crit", targetId: { in: ["s1", "s2"] } });
    expect(out.items.map((i: any) => [i.id, i.commentCount])).toEqual([["s1", 4], ["s2", 0]]);
    expect(out.viewer).toEqual({ id: "u1", name: "Ada Lovelace", photoUrl: "/ada.png" });
  });
});

describe("delete", () => {
  beforeEach(() => db.resourceHubPage.findUnique.mockResolvedValue(page(new Date(0))));

  it("removes the post's comments along with it", async () => {
    db.critSubmission.findFirst.mockResolvedValue({ id: "s1", authorId: "u1" });
    expect((await post({ intent: "delete", id: "s1" })).ok).toBe(true);
    expect(db.docComment.deleteMany).toHaveBeenCalledWith({ where: { targetType: "crit", targetId: "s1" } });
    expect(db.critSubmission.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("leaves someone else's post alone unless the viewer moderates", async () => {
    db.critSubmission.findFirst.mockResolvedValue({ id: "s1", authorId: "u9" });
    expect((await post({ intent: "delete", id: "s1" })).status).toBe(403);
    expect(db.critSubmission.delete).not.toHaveBeenCalled();
    vi.mocked(requireResourceHubViewer).mockResolvedValue({ user: { sub: "u1" }, core: true, userName: "Ada Lovelace" } as any);
    await post({ intent: "delete", id: "s1" });
    expect(db.critSubmission.delete).toHaveBeenCalledTimes(1);
  });
});
