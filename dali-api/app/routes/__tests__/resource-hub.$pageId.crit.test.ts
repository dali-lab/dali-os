import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    resourceHubPage: { findUnique: vi.fn() },
    critSubmission: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("~/lib/resource-hub.server", () => ({ canEditResourceHub: vi.fn(), ledDomainIds: vi.fn(), requireResourceHubViewer: vi.fn() }));
vi.mock("~/lib/link-preview.server", () => ({ fetchLinkPreview: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { canEditResourceHub, ledDomainIds, requireResourceHubViewer } from "~/lib/resource-hub.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";
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
