import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  resourceHubPage: { findMany: vi.fn() },
}));
const hub = vi.hoisted(() => ({ resourceHubViewer: vi.fn(), ledDomainIds: vi.fn() }));

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/resource-hub/lib/resource-hub.server", () => hub);

import { searchResourceHubs } from "../resource-hub-search.server";

const like = { contains: "des", mode: "insensitive" as const };
const budget = { rawTake: 40, cap: 5, ordered: false };
const opts = { userId: "u1" };

beforeEach(() => {
  vi.resetAllMocks();
  hub.resourceHubViewer.mockResolvedValue({ core: false });
  hub.ledDomainIds.mockResolvedValue([]);
  db.resourceHubPage.findMany.mockResolvedValue([]);
});

describe("searchResourceHubs", () => {
  it("returns nothing, without querying, when the flag is off or the caller is not a member", async () => {
    hub.resourceHubViewer.mockResolvedValue(null);
    expect(await searchResourceHubs(opts, "des", like, budget)).toEqual([]);
    expect(db.resourceHubPage.findMany).not.toHaveBeenCalled();
  });

  it("limits a member to published hubs, their own drafts and the drafts of domains they lead", async () => {
    hub.ledDomainIds.mockResolvedValue(["d2"]);
    await searchResourceHubs(opts, "des", like, budget);
    expect(db.resourceHubPage.findMany.mock.calls[0][0].where).toEqual({
      AND: [
        { OR: [{ publishedAt: { not: null } }, { createdById: "u1" }, { domainId: { in: ["d2"] } }] },
        { OR: [{ title: like }, { domain: { displayName: like } }] },
      ],
    });
  });

  it("does not restrict Core to published hubs", async () => {
    hub.resourceHubViewer.mockResolvedValue({ core: true });
    await searchResourceHubs(opts, "des", like, budget);
    expect(db.resourceHubPage.findMany.mock.calls[0][0].where.AND[0]).toEqual({});
    expect(hub.ledDomainIds).not.toHaveBeenCalled();
  });

  it("shows the domain, marks drafts and links to the hub", async () => {
    db.resourceHubPage.findMany.mockResolvedValue([
      { id: "h1", title: "Design", publishedAt: new Date(0), domain: { displayName: "Design" } },
      { id: "h2", title: "Design drafts", publishedAt: null, domain: { displayName: "Fullstack" } },
      { id: "h3", title: "Designers", publishedAt: new Date(0), domain: null },
    ]);
    const out = await searchResourceHubs(opts, "des", like, budget);
    expect(out).toEqual([
      { type: "resourceHub", id: "h1", title: "Design", subtitle: "Design", url: "/resource-hub/h1" },
      { type: "resourceHub", id: "h2", title: "Design drafts", subtitle: "Fullstack · Draft", url: "/resource-hub/h2" },
      { type: "resourceHub", id: "h3", title: "Designers", subtitle: "Resource Hub", url: "/resource-hub/h3" },
    ]);
  });

  it("orders candidates by id when a single category is paged", async () => {
    await searchResourceHubs(opts, "des", like, { ...budget, ordered: true });
    expect(db.resourceHubPage.findMany.mock.calls[0][0].orderBy).toEqual({ id: "asc" });
  });
});
