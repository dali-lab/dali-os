import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { resourceHubPage: { findMany: vi.fn(), create: vi.fn() } } }));
vi.mock("~/lib/resource-hub.server", () => ({ hubDomainOptions: vi.fn(), ledDomainIds: vi.fn(), requireResourceHubViewer: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { hubDomainOptions, ledDomainIds, requireResourceHubViewer } from "~/lib/resource-hub.server";
import { action, loader } from "~/routes/resource-hub";

const db = vi.mocked(prisma, true);
const options = [
  { id: "d1", name: "Design", taken: true },
  { id: "d2", name: "Fullstack", taken: false },
];

const post = (fields: Record<string, string>) => {
  const body = new FormData();
  Object.entries(fields).forEach(([k, v]) => body.set(k, v));
  return action({ request: new Request("http://localhost/resource-hub", { method: "POST", body }), params: {}, context: {} } as any) as Promise<any>;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceHubViewer).mockResolvedValue({ user: { sub: "u1" }, core: false, userName: "Ada" } as any);
  vi.mocked(ledDomainIds).mockResolvedValue([]);
  vi.mocked(hubDomainOptions).mockResolvedValue(options);
  db.resourceHubPage.findMany.mockResolvedValue([]);
  db.resourceHubPage.create.mockResolvedValue({ id: "p9" } as any);
});

describe("loader", () => {
  it("hands the create dialog the domains this viewer may use", async () => {
    const data = (await loader({ request: new Request("http://localhost/resource-hub"), params: {}, context: {} } as any)) as any;
    expect(hubDomainOptions).toHaveBeenCalledWith("u1", false);
    expect(data.domains).toEqual(options);
  });
});

describe("loader draft visibility", () => {
  const run = () => loader({ request: new Request("http://localhost/resource-hub"), params: {}, context: {} } as any);
  const where = () => db.resourceHubPage.findMany.mock.calls[0]![0]!.where;

  it("shows a member published hubs and their own drafts", async () => {
    await run();
    expect(where()).toEqual({ OR: [{ publishedAt: { not: null } }, { createdById: "u1" }] });
  });

  it("adds drafts of the domains a member leads this term", async () => {
    vi.mocked(ledDomainIds).mockResolvedValue(["d2"]);
    await run();
    expect(where()).toEqual({ OR: [{ publishedAt: { not: null } }, { createdById: "u1" }, { domainId: { in: ["d2"] } }] });
  });

  it("shows Core every hub without looking up led domains", async () => {
    vi.mocked(requireResourceHubViewer).mockResolvedValue({ user: { sub: "u1" }, core: true, userName: "Ada" } as any);
    await run();
    expect(where()).toEqual({});
    expect(ledDomainIds).not.toHaveBeenCalled();
  });

  it("marks drafts in the cards it returns", async () => {
    db.resourceHubPage.findMany.mockResolvedValue([
      { id: "a", title: "A", coverUrl: null, publishedAt: new Date(0) },
      { id: "b", title: "B", coverUrl: null, publishedAt: null },
    ] as any);
    const data = (await run()) as any;
    expect(data.cards.map((c: any) => [c.id, c.published])).toEqual([["a", true], ["b", false]]);
  });
});

describe("create", () => {
  it("writes the chosen domain and redirects to the new hub", async () => {
    const res = await post({ intent: "create", domainId: "d2", title: "Fullstack", cover: "" });
    expect(db.resourceHubPage.create).toHaveBeenCalledWith({ data: { createdById: "u1", domainId: "d2", title: "Fullstack" }, select: { id: true } });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/resource-hub/p9");
  });

  it("does not guess a domain from the ones the user leads", async () => {
    vi.mocked(ledDomainIds).mockResolvedValue(["d2"]);
    const res = await post({ intent: "create", title: "Hub" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pick a domain." });
    expect(db.resourceHubPage.create).not.toHaveBeenCalled();
  });

  it("refuses a domain the user can't create for", async () => {
    const res = await post({ intent: "create", domainId: "d3" });
    expect(res.status).toBe(403);
    expect(db.resourceHubPage.create).not.toHaveBeenCalled();
  });

  it("refuses a domain that already has a hub", async () => {
    const res = await post({ intent: "create", domainId: "d1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That domain already has a hub." });
    expect(db.resourceHubPage.create).not.toHaveBeenCalled();
  });

  it("gives the same friendly error when another hub wins the race", async () => {
    db.resourceHubPage.create.mockRejectedValue(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    const res = await post({ intent: "create", domainId: "d2" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That domain already has a hub." });
  });

  it("rethrows other database errors", async () => {
    db.resourceHubPage.create.mockRejectedValue(new Error("down"));
    await expect(post({ intent: "create", domainId: "d2" })).rejects.toThrow("down");
  });

  it("rejects a cover that isn't a pattern", async () => {
    await expect(post({ intent: "create", domainId: "d2", cover: "https://x.example/a.png" })).rejects.toMatchObject({ status: 400 });
  });
});
