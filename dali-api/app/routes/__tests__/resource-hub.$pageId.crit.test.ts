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
import { CRIT_PAGE_SIZE, UPLOAD_URL_PREFIX } from "~/lib/crit.server";

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
    expect((await get()).items).toEqual([]);
  });
  it("lets any member into a published hub", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(page(new Date(0)));
    expect((await get()).items).toEqual([]);
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
    db.critSubmission.findMany.mockResolvedValue([row("s1"), row("s2")] as never);
    db.docComment.groupBy.mockResolvedValue([{ targetId: "s1", _count: { _all: 4 } }] as never);
    const out = await get();
    expect(db.docComment.groupBy.mock.calls[0][0].where).toEqual({ targetType: "crit", targetId: { in: ["s1", "s2"] } });
    expect(out.items.map((i: any) => [i.id, i.commentCount])).toEqual([["s1", 4], ["s2", 0]]);
    expect(out.viewer).toEqual({ id: "u1", name: "Ada Lovelace", photoUrl: "/ada.png" });
  });
});

describe("loader paging", () => {
  const row = (n: number) => ({ id: `s${n}`, title: "t", question: null, kind: "image", url: "/a.png", previewUrl: null, fileName: null, anonymous: false, authorId: "u9", author: null, createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, 100 - n)) });
  beforeEach(() => db.resourceHubPage.findUnique.mockResolvedValue(page(new Date(0))));

  it("returns one page of the domain's posts, newest first, with a cursor when more remain", async () => {
    db.critSubmission.findMany.mockResolvedValue(Array.from({ length: CRIT_PAGE_SIZE + 1 }, (_, i) => row(i)) as never);
    const out = await get();
    expect(db.critSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { domainId: "d1" }, take: CRIT_PAGE_SIZE + 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }));
    expect(out.items).toHaveLength(CRIT_PAGE_SIZE);
    expect(out.nextCursor).toBe(`${row(CRIT_PAGE_SIZE - 1).createdAt.toISOString()}|s${CRIT_PAGE_SIZE - 1}`);
    expect(db.docComment.groupBy.mock.calls[0][0].where.targetId.in).toHaveLength(CRIT_PAGE_SIZE);
  });

  it("has no cursor on the last page", async () => {
    db.critSubmission.findMany.mockResolvedValue([row(0)] as never);
    expect((await get()).nextCursor).toBeNull();
  });

  it("serves the next page after the cursor from the page endpoint", async () => {
    db.critSubmission.findMany.mockResolvedValue([row(30)] as never);
    const cursor = `${row(5).createdAt.toISOString()}|s5`;
    const res = await (await import("~/routes/api.resource-hub.$pageId.crit")).loader({ request: new Request(`http://localhost/api/resource-hub/p1/crit?cursor=${encodeURIComponent(cursor)}`), params, context: {} } as any);
    expect((await (res as Response).json()).items.map((i: any) => i.id)).toEqual(["s30"]);
    const where = db.critSubmission.findMany.mock.calls[0][0]!.where as any;
    expect(where.domainId).toBe("d1");
    expect(where.OR[0]).toEqual({ createdAt: { lt: row(5).createdAt } });
  });

  it("re-reads specific posts within this domain only", async () => {
    db.critSubmission.findMany.mockResolvedValue([row(7)] as never);
    const res = await (await import("~/routes/api.resource-hub.$pageId.crit")).loader({ request: new Request("http://localhost/api/resource-hub/p1/crit?ids=s7,s8"), params, context: {} } as any);
    expect((await (res as Response).json()).items.map((i: any) => i.id)).toEqual(["s7"]);
    expect(db.critSubmission.findMany.mock.calls[0][0]!.where).toEqual({ domainId: "d1", id: { in: ["s7", "s8"] } });
  });

  it("loads a linked post that sits beyond the first page", async () => {
    db.critSubmission.findMany.mockResolvedValueOnce([row(0)] as never);
    db.critSubmission.findFirst.mockResolvedValue(null);
    db.critSubmission.findMany.mockResolvedValueOnce([row(99)] as never);
    const out = await loader({ request: new Request("http://localhost/resource-hub/p1/crit?post=s99"), params, context: {} } as any) as any;
    expect(out.linked).toMatchObject({ id: "s99" });
    expect(db.critSubmission.findMany.mock.calls[1][0]!.where).toEqual({ domainId: "d1", id: { in: ["s99"] } });
  });
});

describe("create", () => {
  beforeEach(() => db.resourceHubPage.findUnique.mockResolvedValue(page(new Date(0))));

  it("rejects a post with neither an upload nor a web link", async () => {
    const res = await post({ intent: "create", kind: "link", url: "javascript:alert(1)" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/web link/);
    expect((await post({ intent: "create", kind: "image", url: "https://evil.example/a.png" })).status).toBe(400);
    expect(db.critSubmission.create).not.toHaveBeenCalled();
  });

  it("stores an anonymous post with its author, so the poster can still edit it", async () => {
    expect((await post({ intent: "create", kind: "image", url: `${UPLOAD_URL_PREFIX}a.png`, fileName: "a.png", title: "Logo", anonymous: "1" })).ok).toBe(true);
    expect(db.critSubmission.create).toHaveBeenCalledWith({
      data: { domainId: "d1", authorId: "u1", anonymous: true, kind: "image", url: `${UPLOAD_URL_PREFIX}a.png`, fileName: "a.png", previewUrl: null, title: "Logo", question: null },
    });
  });

  it("stores a normal post as not anonymous, and titles a link from its preview", async () => {
    await post({ intent: "create", kind: "link", url: "https://example.com/x" });
    expect(db.critSubmission.create).toHaveBeenCalledWith({ data: expect.objectContaining({ anonymous: false, title: "T", authorId: "u1" }) });
  });
});

describe("edit", () => {
  beforeEach(() => db.resourceHubPage.findUnique.mockResolvedValue(page(new Date(0))));

  it("lets the owner change the title and question", async () => {
    db.critSubmission.findFirst.mockResolvedValue({ id: "s1", authorId: "u1" } as never);
    expect((await post({ intent: "edit", id: "s1", title: "  New   title ", question: " Why? " })).ok).toBe(true);
    expect(db.critSubmission.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { title: "New title", question: "Why?" } });
  });

  it("requires a title", async () => {
    db.critSubmission.findFirst.mockResolvedValue({ id: "s1", authorId: "u1" } as never);
    const res = await post({ intent: "edit", id: "s1", title: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Add a title.");
    expect(db.critSubmission.update).not.toHaveBeenCalled();
  });

  it("refuses anyone but the owner, moderators included", async () => {
    db.critSubmission.findFirst.mockResolvedValue({ id: "s1", authorId: "u9" } as never);
    vi.mocked(requireResourceHubViewer).mockResolvedValue({ user: { sub: "u1" }, core: true, userName: "Ada Lovelace" } as any);
    expect((await post({ intent: "edit", id: "s1", title: "x" })).status).toBe(403);
    expect(db.critSubmission.update).not.toHaveBeenCalled();
  });

  it("404s a post from another domain, looking it up only within this one", async () => {
    db.critSubmission.findFirst.mockResolvedValue(null);
    expect((await post({ intent: "edit", id: "other", title: "x" })).status).toBe(404);
    expect((await post({ intent: "delete", id: "other" })).status).toBe(404);
    expect(db.critSubmission.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "other", domainId: "d1" } }));
    expect(db.critSubmission.update).not.toHaveBeenCalled();
    expect(db.critSubmission.delete).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  beforeEach(() => db.resourceHubPage.findUnique.mockResolvedValue(page(new Date(0))));

  it("removes the post's comments along with it", async () => {
    db.critSubmission.findFirst.mockResolvedValue({ id: "s1", authorId: "u1" } as never);
    expect((await post({ intent: "delete", id: "s1" })).ok).toBe(true);
    expect(db.docComment.deleteMany).toHaveBeenCalledWith({ where: { targetType: "crit", targetId: "s1" } });
    expect(db.critSubmission.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("leaves someone else's post alone unless the viewer moderates", async () => {
    db.critSubmission.findFirst.mockResolvedValue({ id: "s1", authorId: "u9" } as never);
    expect((await post({ intent: "delete", id: "s1" })).status).toBe(403);
    expect(db.critSubmission.delete).not.toHaveBeenCalled();
    vi.mocked(requireResourceHubViewer).mockResolvedValue({ user: { sub: "u1" }, core: true, userName: "Ada Lovelace" } as any);
    await post({ intent: "delete", id: "s1" });
    expect(db.critSubmission.delete).toHaveBeenCalledTimes(1);
  });
});
