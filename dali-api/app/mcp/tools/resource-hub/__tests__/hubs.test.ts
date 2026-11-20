import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  resourceHubPage: { findMany: vi.fn() },
}));
const hub = vi.hoisted(() => ({
  resourceHubViewer: vi.fn(),
  loadHubAccess: vi.fn(),
  ledDomainIds: vi.fn(),
}));
const read = vi.hoisted(() => ({ readDocAsBlocks: vi.fn() }));

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/resource-hub/lib/resource-hub.server", () => hub);
vi.mock("~/collab/read", () => read);
vi.mock("~/collab/blocknote-server", () => ({ blocksToMarkdown: vi.fn(async () => "# Welcome\n\nBody text") }));

import { runGetResourceHub, runListResourceHubs } from "../hubs";
import { RESOURCE_HUB_TOOLS } from "..";
import type { McpCtx } from "~/mcp/registry";

const ctx = (id = "me"): McpCtx => ({
  user: { id, daliEmail: null, dartmouthEmail: null, netId: null, firstName: "Ada", lastName: "Lovelace" },
  scopes: ["mcp:read", "mcp:write"],
  request: new Request("http://x/mcp", { method: "POST" }),
});

type HubRow = { id: string; title: string; coverUrl: string | null; publishedAt: Date | null; domainId: string | null; createdById: string | null; domain: { displayName: string } | null };
const HUB: HubRow = {
  id: "hub1",
  title: "Design",
  coverUrl: null,
  publishedAt: new Date(0),
  domainId: "d1",
  createdById: "lead",
  domain: { displayName: "Design" },
};
const access = (over: Partial<{ canEdit: boolean; core: boolean; viewerId: string; hub: HubRow }> = {}) => ({
  hub: HUB,
  viewerId: "me",
  core: false,
  canEdit: false,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  hub.resourceHubViewer.mockResolvedValue({ core: false });
  hub.loadHubAccess.mockResolvedValue(access());
  hub.ledDomainIds.mockResolvedValue([]);
  read.readDocAsBlocks.mockResolvedValue([{ id: "b", type: "paragraph" }]);
});

describe("registration", () => {
  it("lists two read-only tools behind the resource-hub flag", () => {
    expect(RESOURCE_HUB_TOOLS.map((t) => t.def.name)).toEqual([
      "list_resource_hubs",
      "get_resource_hub",
    ]);
    expect(RESOURCE_HUB_TOOLS.every((t) => t.featureFlag === "resource-hub")).toBe(true);
    const scopes = Object.fromEntries(RESOURCE_HUB_TOOLS.map((t) => [t.def.name, t.def.requiredScope]));
    expect(scopes).toEqual({
      list_resource_hubs: "mcp:read",
      get_resource_hub: "mcp:read",
    });
  });
});

describe("list_resource_hubs", () => {
  const row = (id: string, publishedAt: Date | null, domainId: string | null, createdById: string | null) => ({
    id,
    title: `Hub ${id}`,
    publishedAt,
    domainId,
    createdById,
    domain: domainId ? { displayName: `Domain ${domainId}` } : null,
  });

  it("is not found when the flag is off or the caller is not a member", async () => {
    hub.resourceHubViewer.mockResolvedValue(null);
    await expect(runListResourceHubs(ctx())).rejects.toMatchObject({ status: 404 });
    expect(db.resourceHubPage.findMany).not.toHaveBeenCalled();
  });

  it("limits a member to published hubs, their own drafts and the drafts of domains they lead", async () => {
    hub.ledDomainIds.mockResolvedValue(["d2"]);
    db.resourceHubPage.findMany.mockResolvedValue([
      row("h1", new Date(0), "d1", "x"),
      row("h2", null, "d2", "x"),
      row("h3", null, "d3", "me"),
    ]);
    const { hubs } = await runListResourceHubs(ctx());
    expect(db.resourceHubPage.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ publishedAt: { not: null } }, { createdById: "me" }, { domainId: { in: ["d2"] } }],
    });
    expect(hubs).toEqual([
      { id: "h1", domainId: "d1", domain: "Domain d1", title: "Hub h1", published: true, canEdit: false, url: "/resource-hub/h1" },
      { id: "h2", domainId: "d2", domain: "Domain d2", title: "Hub h2", published: false, canEdit: true, url: "/resource-hub/h2" },
      { id: "h3", domainId: "d3", domain: "Domain d3", title: "Hub h3", published: false, canEdit: true, url: "/resource-hub/h3" },
    ]);
  });

  it("shows Core every hub and marks all editable", async () => {
    hub.resourceHubViewer.mockResolvedValue({ core: true });
    db.resourceHubPage.findMany.mockResolvedValue([row("h2", null, "d2", "x")]);
    const { hubs } = await runListResourceHubs(ctx("core"));
    expect(db.resourceHubPage.findMany.mock.calls[0][0].where).toEqual({});
    expect(hub.ledDomainIds).not.toHaveBeenCalled();
    expect(hubs[0]).toMatchObject({ published: false, canEdit: true });
  });
});

describe("get_resource_hub", () => {
  it("asks for a hubId or domainId", async () => {
    await expect(runGetResourceHub(ctx(), {})).rejects.toMatchObject({ status: 400 });
    expect(hub.loadHubAccess).not.toHaveBeenCalled();
  });

  it("is not found when the hub is hidden from the caller (flag off, non-member or draft)", async () => {
    hub.loadHubAccess.mockResolvedValue(null);
    await expect(runGetResourceHub(ctx(), { hubId: "hub1" })).rejects.toMatchObject({ status: 404 });
    expect(read.readDocAsBlocks).not.toHaveBeenCalled();
  });

  it("returns the page as Markdown", async () => {
    const out = await runGetResourceHub(ctx(), { domainId: "d1" });
    expect(hub.loadHubAccess).toHaveBeenCalledWith("me", { domainId: "d1" }, expect.any(Request));
    expect(read.readDocAsBlocks).toHaveBeenCalledWith("resourceHub:hub1:body");
    expect(out).toMatchObject({
      id: "hub1",
      title: "Design",
      domain: "Design",
      published: true,
      canEdit: false,
      url: "/resource-hub/hub1",
      markdown: "# Welcome\n\nBody text",
    });
  });

  it("returns an empty page for a hub nobody has written in yet", async () => {
    read.readDocAsBlocks.mockResolvedValue([]);
    expect((await runGetResourceHub(ctx(), { hubId: "hub1" })).markdown).toBe("");
  });
});
