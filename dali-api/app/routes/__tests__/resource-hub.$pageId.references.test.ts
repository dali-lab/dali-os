import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    resourceHubPage: { findUnique: vi.fn() },
    domainReference: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("~/lib/resource-hub.server", () => ({ canEditResourceHub: vi.fn(), ledDomainIds: vi.fn(), requireResourceHubViewer: vi.fn() }));
vi.mock("~/lib/link-preview.server", () => ({ fetchLinkPreview: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { canEditResourceHub, ledDomainIds, requireResourceHubViewer } from "~/lib/resource-hub.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";
import { _resetForTests } from "~/lib/rate-limit";
import { action, loader } from "~/routes/resource-hub.$pageId.references";
import { loader as pageApi } from "~/routes/api.resource-hub.$pageId.references";
import { REFERENCES_PAGE_SIZE } from "~/lib/references.server";

const db = vi.mocked(prisma, true);
const params = { pageId: "p1" };

const post = (fields: Record<string, string>) => {
  const body = new FormData();
  Object.entries(fields).forEach(([k, v]) => body.set(k, v));
  return action({ request: new Request("http://localhost/resource-hub/p1/references", { method: "POST", body }), params, context: {} } as any) as Promise<any>;
};
const get = () => loader({ request: new Request("http://localhost/resource-hub/p1/references"), params, context: {} } as any) as Promise<any>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceHubViewer).mockResolvedValue({ user: { sub: "u1" }, core: false, userName: "Ada Lovelace" } as any);
  vi.mocked(ledDomainIds).mockResolvedValue([]);
  vi.mocked(canEditResourceHub).mockResolvedValue(false);
  _resetForTests();
  db.resourceHubPage.findUnique.mockResolvedValue({ id: "p1", domainId: "d1", title: "Design", coverUrl: "pattern:grid", publishedAt: new Date(0), domain: { displayName: "Design" } } as any);
  vi.mocked(fetchLinkPreview).mockResolvedValue({ title: "Page title", image: "https://img.example/a.png", description: null });
});

describe("loader", () => {
  it("lists only this domain's references, newest first", async () => {
    db.domainReference.findMany.mockResolvedValue([
      { id: "r1", title: "A", kind: "link", url: "https://a.example", previewUrl: null, fileName: null, creatorName: null, daliMade: true, note: null, authorId: "u1", author: { firstName: "Ada", lastName: "Lovelace" }, createdAt: new Date(0) },
    ] as any);
    const data = await get();
    expect(db.domainReference.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { domainId: "d1" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: REFERENCES_PAGE_SIZE + 1 }));
    expect(data.items[0]).toMatchObject({ id: "r1", daliMade: true, creatorName: "Ada Lovelace", mine: true });
  });
  it("leaves the hub's title and cover to the layout", async () => {
    db.domainReference.findMany.mockResolvedValue([]);
    expect(Object.keys(await get()).sort()).toEqual(["items", "linked", "nextCursor", "pageId"]);
  });

  describe("paging", () => {
    const ref = (n: number) => ({ id: `r${n}`, title: "A", kind: "link", url: "https://a.example", previewUrl: null, fileName: null, creatorName: null, daliMade: false, note: null, authorId: "u9", author: null, createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, 100 - n)) });

    it("returns one page with a cursor when more remain", async () => {
      db.domainReference.findMany.mockResolvedValue(Array.from({ length: REFERENCES_PAGE_SIZE + 1 }, (_, i) => ref(i)) as never);
      const out = await get();
      expect(out.items).toHaveLength(REFERENCES_PAGE_SIZE);
      expect(out.nextCursor).toBe(`${ref(REFERENCES_PAGE_SIZE - 1).createdAt.toISOString()}|r${REFERENCES_PAGE_SIZE - 1}`);
    });

    it("has no cursor on the last page", async () => {
      db.domainReference.findMany.mockResolvedValue([ref(0)] as never);
      expect((await get()).nextCursor).toBeNull();
    });

    it("serves the next page after the cursor from the page endpoint", async () => {
      db.domainReference.findMany.mockResolvedValue([ref(30)] as never);
      const cursor = `${ref(5).createdAt.toISOString()}|r5`;
      const res = (await pageApi({ request: new Request(`http://localhost/api/resource-hub/p1/references?cursor=${encodeURIComponent(cursor)}`), params, context: {} } as any)) as Response;
      expect((await res.json()).items.map((i: any) => i.id)).toEqual(["r30"]);
      expect((db.domainReference.findMany.mock.calls[0][0]!.where as any).OR[0]).toEqual({ createdAt: { lt: ref(5).createdAt } });
    });

    it("re-reads specific references within this domain only", async () => {
      db.domainReference.findMany.mockResolvedValue([ref(7)] as never);
      const res = (await pageApi({ request: new Request("http://localhost/api/resource-hub/p1/references?ids=r7,r8"), params, context: {} } as any)) as Response;
      expect((await res.json()).items.map((i: any) => i.id)).toEqual(["r7"]);
      expect(db.domainReference.findMany.mock.calls[0][0]!.where).toEqual({ domainId: "d1", id: { in: ["r7", "r8"] } });
    });

    it("loads a linked reference that sits beyond the first page", async () => {
      db.domainReference.findMany.mockResolvedValueOnce([ref(0)] as never).mockResolvedValueOnce([ref(99)] as never);
      const out = (await loader({ request: new Request("http://localhost/resource-hub/p1/references?r=r99"), params, context: {} } as any)) as any;
      expect(out.linked).toMatchObject({ id: "r99" });
    });
  });
  it("404s for a hub with no domain, so it has no gallery", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue({ id: "p1", domainId: null, domain: null } as any);
    await expect(get()).rejects.toMatchObject({ status: 404 });
  });
});

describe("draft hub", () => {
  const draft = { id: "p1", domainId: "d1", createdById: "u9", title: "Design", coverUrl: null, publishedAt: null, domain: { displayName: "Design" } } as any;
  it("404s the loader and the action for someone who can't edit the hub", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(draft);
    await expect(get()).rejects.toMatchObject({ status: 404 });
    await expect(post({ intent: "create", kind: "link", url: "https://example.com" })).rejects.toMatchObject({ status: 404 });
    expect(db.domainReference.create).not.toHaveBeenCalled();
    expect(canEditResourceHub).toHaveBeenCalledWith("u1", expect.objectContaining({ createdById: "u9", domainId: "d1" }));
  });
  it("lets an editor through", async () => {
    db.resourceHubPage.findUnique.mockResolvedValue(draft);
    vi.mocked(canEditResourceHub).mockResolvedValue(true);
    db.domainReference.findMany.mockResolvedValue([]);
    expect((await get()).items).toEqual([]);
  });
  it("does not check editing for a published hub", async () => {
    db.domainReference.findMany.mockResolvedValue([]);
    await get();
    expect(canEditResourceHub).not.toHaveBeenCalled();
  });
});

describe("create", () => {
  it("rate limits link previews per user and skips the fetch", async () => {
    for (let i = 0; i < 20; i++) await post({ intent: "create", kind: "link", url: "https://example.com" });
    vi.mocked(fetchLinkPreview).mockClear();
    const res = await post({ intent: "create", kind: "link", url: "https://example.com" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests" });
    expect(fetchLinkPreview).not.toHaveBeenCalled();
  });
  it("saves a link under the domain, the poster, and the title and image the page advertises", async () => {
    const res = await post({ intent: "create", kind: "link", url: "https://example.com/work", creator: "other", creatorName: "Studio X", note: "Love the type" });
    expect(res).toEqual({ ok: true });
    expect(db.domainReference.create).toHaveBeenCalledWith({
      data: { domainId: "d1", authorId: "u1", kind: "link", url: "https://example.com/work", fileName: null, previewUrl: "https://img.example/a.png", title: "Page title", creatorName: "Studio X", daliMade: false, note: "Love the type" },
    });
  });
  it("badges my work as DALI-made with no separate creator", async () => {
    await post({ intent: "create", kind: "link", url: "https://example.com", creator: "mine", creatorName: "Spoofed", title: "Our site" });
    expect(db.domainReference.create).toHaveBeenCalledWith({ data: expect.objectContaining({ daliMade: true, creatorName: null, title: "Our site", authorId: "u1" }) });
  });
  it("rejects a bad link without writing", async () => {
    const res = await post({ intent: "create", kind: "link", url: "javascript:alert(1)" });
    expect(res.status).toBe(400);
    expect(db.domainReference.create).not.toHaveBeenCalled();
  });
  it("rejects an upload that did not come from the app's own storage", async () => {
    const res = await post({ intent: "create", kind: "image", url: "https://evil.example/x.png" });
    expect(res.status).toBe(400);
    expect(db.domainReference.create).not.toHaveBeenCalled();
  });
  it("is closed to anyone who can't view the hub", async () => {
    vi.mocked(requireResourceHubViewer).mockRejectedValue(new Response("Not found", { status: 404 }));
    await expect(post({ intent: "create", kind: "link", url: "https://example.com" })).rejects.toMatchObject({ status: 404 });
    expect(db.domainReference.create).not.toHaveBeenCalled();
  });
});

describe("edit", () => {
  beforeEach(() => db.domainReference.findFirst.mockResolvedValue({ id: "r1", authorId: "u1" } as any));

  it("lets the poster change title, note and credit", async () => {
    const res = await post({ intent: "edit", id: "r1", title: "Better", note: "", creator: "mine", creatorName: "" });
    expect(res).toEqual({ ok: true });
    expect(db.domainReference.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { title: "Better", note: null, daliMade: true, creatorName: null } });
  });
  it("looks the reference up within this domain only", async () => {
    await post({ intent: "edit", id: "r1", title: "Better" });
    expect(db.domainReference.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", domainId: "d1" } }));
  });
  it("404s for a reference in another domain", async () => {
    db.domainReference.findFirst.mockResolvedValue(null);
    const res = await post({ intent: "edit", id: "other", title: "x" });
    expect(res.status).toBe(404);
    expect(db.domainReference.update).not.toHaveBeenCalled();
  });
  it("refuses someone else's reference, even for a moderator", async () => {
    vi.mocked(requireResourceHubViewer).mockResolvedValue({ user: { sub: "u2" }, core: true, userName: "Core" } as any);
    const res = await post({ intent: "edit", id: "r1", title: "x" });
    expect(res.status).toBe(403);
    expect(db.domainReference.update).not.toHaveBeenCalled();
  });
  it("needs a title", async () => {
    const res = await post({ intent: "edit", id: "r1", title: " " });
    expect(res.status).toBe(400);
    expect(db.domainReference.update).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  beforeEach(() => db.domainReference.findFirst.mockResolvedValue({ id: "r1", authorId: "u9" } as any));

  it("refuses a member who didn't post it", async () => {
    const res = await post({ intent: "delete", id: "r1" });
    expect(res.status).toBe(403);
    expect(db.domainReference.delete).not.toHaveBeenCalled();
  });
  it("lets the poster delete", async () => {
    db.domainReference.findFirst.mockResolvedValue({ id: "r1", authorId: "u1" } as any);
    expect(await post({ intent: "delete", id: "r1" })).toEqual({ ok: true });
    expect(db.domainReference.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
  });
  it("lets a domain lead delete", async () => {
    vi.mocked(ledDomainIds).mockResolvedValue(["d1"]);
    expect(await post({ intent: "delete", id: "r1" })).toEqual({ ok: true });
  });
  it("lets core delete", async () => {
    vi.mocked(requireResourceHubViewer).mockResolvedValue({ user: { sub: "u2" }, core: true, userName: "Core" } as any);
    expect(await post({ intent: "delete", id: "r1" })).toEqual({ ok: true });
  });
  it("does not let a lead of a different domain delete", async () => {
    vi.mocked(ledDomainIds).mockResolvedValue(["d2"]);
    const res = await post({ intent: "delete", id: "r1" });
    expect(res.status).toBe(403);
  });
});

it("rejects an unknown intent", async () => {
  db.domainReference.findFirst.mockResolvedValue({ id: "r1", authorId: "u1" } as any);
  expect((await post({ intent: "nope", id: "r1" })).status).toBe(400);
});
