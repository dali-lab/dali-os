import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  resourceHubPage: { findMany: vi.fn() },
  critSubmission: { findMany: vi.fn(), count: vi.fn() },
  docComment: { groupBy: vi.fn() },
  domainReference: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn(), count: vi.fn() },
}));
const hub = vi.hoisted(() => ({
  resourceHubViewer: vi.fn(),
  loadHubAccess: vi.fn(),
  ledDomainIds: vi.fn(),
}));
const read = vi.hoisted(() => ({ readDocAsBlocks: vi.fn() }));
const limit = vi.hoisted(() => ({ limitLinkPreviews: vi.fn() }));
const preview = vi.hoisted(() => ({ fetchLinkPreview: vi.fn() }));

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/resource-hub.server", () => hub);
vi.mock("~/collab/read", () => read);
vi.mock("~/collab/blocknote-server", () => ({ blocksToMarkdown: vi.fn(async () => "# Welcome\n\nBody text") }));
vi.mock("~/lib/link-preview-limit.server", () => limit);
vi.mock("~/lib/link-preview.server", () => preview);

import {
  runGetResourceHub,
  runListCritPosts,
  runListDomainReferences,
  runListResourceHubs,
  runManageDomainReference,
} from "../hubs";
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
const access = (over: Partial<{ canEdit: boolean; canModerate: boolean; core: boolean; viewerId: string; hub: HubRow }> = {}) => ({
  hub: HUB,
  viewerId: "me",
  core: false,
  canEdit: false,
  canModerate: false,
  ...over,
});

const person = (firstName: string, lastName: string) => ({ firstName, lastName });
const post = (id: string, authorId: string | null, anonymous: boolean, who = person("Ada", "Poster")) => ({
  id,
  title: `Post ${id}`,
  question: null,
  kind: "image",
  url: "/api/upload/raw?key=uploads%2Fa.png",
  previewUrl: null,
  fileName: null,
  anonymous,
  authorId,
  author: who,
  createdAt: new Date(0),
});

beforeEach(() => {
  vi.resetAllMocks();
  hub.resourceHubViewer.mockResolvedValue({ core: false });
  hub.loadHubAccess.mockResolvedValue(access());
  hub.ledDomainIds.mockResolvedValue([]);
  read.readDocAsBlocks.mockResolvedValue([{ id: "b", type: "paragraph" }]);
  limit.limitLinkPreviews.mockReturnValue(null);
  preview.fetchLinkPreview.mockResolvedValue({ title: "Moodboard", image: "https://img.test/a.png" });
  db.docComment.groupBy.mockResolvedValue([]);
  db.critSubmission.count.mockResolvedValue(0);
  db.domainReference.count.mockResolvedValue(0);
});

describe("registration", () => {
  it("lists five tools, all behind the resource-hub flag, with writes needing mcp:write", () => {
    expect(RESOURCE_HUB_TOOLS.map((t) => t.def.name)).toEqual([
      "list_resource_hubs",
      "get_resource_hub",
      "list_crit_posts",
      "list_domain_references",
      "manage_domain_reference",
    ]);
    expect(RESOURCE_HUB_TOOLS.every((t) => t.featureFlag === "resource-hub")).toBe(true);
    const scopes = Object.fromEntries(RESOURCE_HUB_TOOLS.map((t) => [t.def.name, t.def.requiredScope]));
    expect(scopes).toEqual({
      list_resource_hubs: "mcp:read",
      get_resource_hub: "mcp:read",
      list_crit_posts: "mcp:read",
      list_domain_references: "mcp:read",
      manage_domain_reference: "mcp:write",
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

  it("returns the page as Markdown with the post and reference counts", async () => {
    db.critSubmission.count.mockResolvedValue(3);
    db.domainReference.count.mockResolvedValue(7);
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
      critPostCount: 3,
      referenceCount: 7,
    });
    expect(db.critSubmission.count).toHaveBeenCalledWith({ where: { domainId: "d1" } });
  });

  it("returns an empty page for a hub nobody has written in yet", async () => {
    read.readDocAsBlocks.mockResolvedValue([]);
    expect((await runGetResourceHub(ctx(), { hubId: "hub1" })).markdown).toBe("");
  });

  it("reports zero counts for a hub with no domain", async () => {
    hub.loadHubAccess.mockResolvedValue(access({ hub: { ...HUB, domainId: null, domain: null } }));
    const out = await runGetResourceHub(ctx(), { hubId: "hub1" });
    expect(out).toMatchObject({ critPostCount: 0, referenceCount: 0, domain: null });
    expect(db.critSubmission.count).not.toHaveBeenCalled();
  });
});

describe("list_crit_posts", () => {
  const anon = post("s1", "poster", true);
  const named = post("s2", "poster", false);
  const wire = (r: unknown) => JSON.stringify(r);

  beforeEach(() => {
    db.critSubmission.findMany.mockResolvedValue([anon, named]);
    db.docComment.groupBy.mockResolvedValue([{ targetId: "s1", _count: { _all: 4 } }]);
  });

  it("is not found when the hub is hidden or has no domain", async () => {
    hub.loadHubAccess.mockResolvedValue(null);
    await expect(runListCritPosts(ctx(), { hubId: "hub1" })).rejects.toMatchObject({ status: 404 });
    hub.loadHubAccess.mockResolvedValue(access({ hub: { ...HUB, domainId: null, domain: null } }));
    await expect(runListCritPosts(ctx(), { hubId: "hub1" })).rejects.toMatchObject({ status: 400 });
    expect(db.critSubmission.findMany).not.toHaveBeenCalled();
  });

  it("hides an anonymous poster from other members and keeps named posts named", async () => {
    const { posts } = await runListCritPosts(ctx("u2"), { hubId: "hub1" });
    expect(posts[0]).toMatchObject({ id: "s1", anonymous: true, author: null, mine: false, commentCount: 4 });
    expect(posts[1]).toMatchObject({ id: "s2", anonymous: false, author: { id: "poster", name: "Ada Poster" }, commentCount: 0 });
    expect(posts[0]).not.toHaveProperty("authorName");
    const anonWire = wire(posts[0]);
    expect(anonWire).not.toContain("poster");
    expect(anonWire).not.toContain("Ada");
  });

  it("shows the poster their own anonymous post", async () => {
    hub.loadHubAccess.mockResolvedValue(access({ viewerId: "poster" }));
    const { posts } = await runListCritPosts(ctx("poster"), { hubId: "hub1" });
    expect(posts[0]).toMatchObject({ anonymous: true, mine: true, canDelete: true, author: { id: "poster", name: "Ada Poster" } });
  });

  it("hides an anonymous post's author from moderators too, as the web does", async () => {
    hub.loadHubAccess.mockResolvedValue(access({ viewerId: "lead", canModerate: true }));
    const { posts } = await runListCritPosts(ctx("lead"), { hubId: "hub1" });
    expect(posts[0]).toMatchObject({ anonymous: true, mine: false, canDelete: true, author: null });
    expect(JSON.stringify(posts[0])).not.toContain("poster");
  });

  it("gives each post a link, and pages with limit and cursor", async () => {
    db.critSubmission.findMany.mockResolvedValue([anon, named, post("s3", "x", false)]);
    const { posts, page } = await runListCritPosts(ctx("u2"), { hubId: "hub1", limit: 2 });
    expect(posts).toHaveLength(2);
    expect(posts[0].link).toBe("/resource-hub/hub1/crit?post=s1");
    expect(page).toMatchObject({ hasMore: true, limit: 2 });
    expect(db.critSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { domainId: "d1" }, skip: 0, take: 3 }));
    await runListCritPosts(ctx("u2"), { hubId: "hub1", limit: 2, cursor: page.nextCursor! });
    expect(db.critSubmission.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 2 }));
  });

  it("never selects comment text, only counts", async () => {
    await runListCritPosts(ctx("u2"), { domainId: "d1" });
    expect(db.docComment.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { targetType: "crit", targetId: { in: ["s1", "s2"] } } }));
  });
});

describe("list_domain_references", () => {
  const ref = (id: string, daliMade: boolean) => ({
    id,
    title: `Ref ${id}`,
    kind: "link",
    url: "https://example.edu/a",
    previewUrl: null,
    fileName: null,
    creatorName: daliMade ? null : "Grace Hopper",
    daliMade,
    note: null,
    authorId: "poster",
    author: person("Ada", "Poster"),
    createdAt: new Date(0),
  });

  it("is not found when the hub is hidden or has no domain", async () => {
    hub.loadHubAccess.mockResolvedValue(null);
    await expect(runListDomainReferences(ctx(), { domainId: "d1" })).rejects.toMatchObject({ status: 404 });
    hub.loadHubAccess.mockResolvedValue(access({ hub: { ...HUB, domainId: null, domain: null } }));
    await expect(runListDomainReferences(ctx(), { domainId: "d1" })).rejects.toMatchObject({ status: 400 });
    expect(db.domainReference.findMany).not.toHaveBeenCalled();
  });

  it("lists the domain's references with credit and delete rights", async () => {
    db.domainReference.findMany.mockResolvedValue([ref("r1", true), ref("r2", false)]);
    const out = await runListDomainReferences(ctx("poster"), { hubId: "hub1" });
    expect(db.domainReference.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { domainId: "d1" } }));
    expect(out.references).toHaveLength(2);
    expect(out.references[0]).toMatchObject({ id: "r1", daliMade: true, creatorName: "Ada Poster", sharedBy: "Ada Poster" });
    expect(out.references[1]).toMatchObject({ id: "r2", daliMade: false, creatorName: "Grace Hopper" });
    expect(out.hubUrl).toBe("/resource-hub/hub1/references");
  });
});

describe("manage_domain_reference", () => {
  const created = {
    id: "r9",
    kind: "link",
    url: "https://example.edu/a",
    previewUrl: "https://img.test/a.png",
    fileName: null,
    title: "Moodboard",
    creatorName: null,
    daliMade: false,
    note: null,
    authorId: "me",
    author: person("Ada", "Lovelace"),
    createdAt: new Date(0),
  };
  const add = (extra: Record<string, unknown> = {}) =>
    runManageDomainReference(ctx(), { action: "add", hubId: "hub1", kind: "link", url: "https://example.edu/a", ...extra } as never);

  beforeEach(() => {
    db.domainReference.create.mockResolvedValue(created);
  });

  it("is not found for a hidden hub, and writes nothing", async () => {
    hub.loadHubAccess.mockResolvedValue(null);
    await expect(add()).rejects.toMatchObject({ status: 404 });
    expect(db.domainReference.create).not.toHaveBeenCalled();
  });

  it("adds a link with the page title and preview, authored by the caller", async () => {
    const out = await add({ note: "  Nice   palette " });
    expect(db.domainReference.create).toHaveBeenCalledWith({
      data: {
        domainId: "d1",
        authorId: "me",
        kind: "link",
        url: "https://example.edu/a",
        fileName: null,
        previewUrl: "https://img.test/a.png",
        title: "Moodboard",
        creatorName: null,
        daliMade: false,
        note: "Nice palette",
      },
      include: expect.anything(),
    });
    expect(out).toMatchObject({ ok: true, reference: { id: "r9", mine: true } });
  });

  it("credits the member when daliMade, and ignores creatorName then", async () => {
    await add({ daliMade: true, creatorName: "Someone Else" });
    expect(db.domainReference.create.mock.calls[0][0].data).toMatchObject({ daliMade: true, creatorName: null });
  });

  it("credits another creator when not daliMade", async () => {
    await add({ creatorName: "Grace Hopper" });
    expect(db.domainReference.create.mock.calls[0][0].data).toMatchObject({ daliMade: false, creatorName: "Grace Hopper" });
  });

  it("rejects unsafe or non-web links", async () => {
    for (const url of ["javascript:alert(1)", "ftp://example.edu/a", "not a url", ""]) {
      await expect(add({ url })).rejects.toMatchObject({ status: 400 });
    }
    expect(db.domainReference.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown kind and uploads that are not this app's upload URLs", async () => {
    await expect(add({ kind: "video" })).rejects.toMatchObject({ status: 400 });
    await expect(add({ kind: "image", url: "https://evil.test/a.png" })).rejects.toMatchObject({ status: 400 });
    expect(db.domainReference.create).not.toHaveBeenCalled();
  });

  it("accepts an upload URL from this app and titles it from the file name", async () => {
    await add({ kind: "file", url: "/api/upload/raw?key=uploads%2Fa.pdf", fileName: "brand-guide.pdf" });
    expect(db.domainReference.create.mock.calls[0][0].data).toMatchObject({ kind: "file", fileName: "brand-guide.pdf", title: "brand-guide", previewUrl: null });
    expect(preview.fetchLinkPreview).not.toHaveBeenCalled();
  });

  it("applies the link preview rate limit to links only", async () => {
    limit.limitLinkPreviews.mockReturnValue(new Response("slow down", { status: 429 }));
    await expect(add()).rejects.toMatchObject({ status: 429 });
    expect(limit.limitLinkPreviews).toHaveBeenCalledWith(expect.any(Request), "me");
    expect(db.domainReference.create).not.toHaveBeenCalled();
    await runManageDomainReference(ctx(), { action: "add", hubId: "hub1", kind: "file", url: "/api/upload/raw?key=uploads%2Fa.pdf" } as never);
    expect(db.domainReference.create).toHaveBeenCalledTimes(1);
  });

  describe("delete", () => {
    const del = (id = "r1") => runManageDomainReference(ctx(), { action: "delete", hubId: "hub1", referenceId: id });

    it("needs a referenceId", async () => {
      await expect(runManageDomainReference(ctx(), { action: "delete", hubId: "hub1" })).rejects.toMatchObject({ status: 400 });
    });

    it("is not found for a reference outside the hub's domain", async () => {
      db.domainReference.findFirst.mockResolvedValue(null);
      await expect(del()).rejects.toMatchObject({ status: 404 });
      expect(db.domainReference.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", domainId: "d1" } }));
      expect(db.domainReference.delete).not.toHaveBeenCalled();
    });

    it("lets the member who shared it delete it", async () => {
      db.domainReference.findFirst.mockResolvedValue({ id: "r1", authorId: "me" });
      expect(await del()).toEqual({ ok: true, deleted: "r1" });
      expect(db.domainReference.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    });

    it("refuses another member", async () => {
      db.domainReference.findFirst.mockResolvedValue({ id: "r1", authorId: "someone" });
      await expect(del()).rejects.toMatchObject({ status: 403 });
      expect(db.domainReference.delete).not.toHaveBeenCalled();
    });

    it("lets a moderator delete anyone's reference", async () => {
      hub.loadHubAccess.mockResolvedValue(access({ canModerate: true }));
      db.domainReference.findFirst.mockResolvedValue({ id: "r1", authorId: "someone" });
      await del();
      expect(db.domainReference.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    });
  });
});
