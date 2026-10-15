import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    pageShare: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    page: { findUnique: vi.fn() },
    instructorAssignment: { findFirst: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
  isLabMember: vi.fn(),
}));
vi.mock("~/partners/lib/partner-access", () => ({
  partnerHasProjectAccess: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/lib/groups", () => ({
  resolveGroupMembers: vi.fn().mockResolvedValue([]),
  listVisibleGroupIdsForUser: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { listVisibleGroupIdsForUser } from "~/lib/groups";
import { loadSharedWithMe } from "~/lib/drive-shared.server";

const m = prisma as any;
const VIEWER = "viewer";

type PageOverrides = Record<string, unknown>;

function page(id: string, overrides: PageOverrides = {}) {
  return {
    id,
    title: `Title ${id}`,
    kind: "FreeForm",
    iconEmoji: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    workspaceType: "Member",
    workspaceId: "owner",
    parentPageId: null,
    archivedAt: null,
    createdById: "owner",
    partnerVisible: false,
    profileVisible: false,
    labListing: "None",
    linkAccess: "Restricted",
    linkPermission: "View",
    scopeKind: null,
    scopeGroupId: null,
    scopePermission: null,
    ...overrides,
  };
}

type Received = { pageId: string; createdAt: Date; createdById: string; page: ReturnType<typeof page> };
type Granted = { pageId: string; createdAt: Date; page: ReturnType<typeof page> };

const received = (p: ReturnType<typeof page>, at: string, by = "alice"): Received => ({
  pageId: p.id,
  createdAt: new Date(at),
  createdById: by,
  page: p,
});

/**
 * pageShare.findMany answers three different questions; tell them apart by
 * their `where`: the viewer's received shares, the shares the viewer granted,
 * and the per-page share lookup inside the (non-ignoring) access computation.
 */
function seed(opts: { received?: Received[]; granted?: Granted[]; viewerShares?: Record<string, string> } = {}) {
  m.pageShare.findMany.mockImplementation(async ({ where }: any) => {
    if (where.pageId?.in) {
      return where.pageId.in
        .filter((id: string) => opts.viewerShares?.[id])
        .map((id: string) => ({
          pageId: id,
          principalType: "User",
          principalId: VIEWER,
          permission: opts.viewerShares![id],
        }));
    }
    if (where.createdById) return opts.granted ?? [];
    return opts.received ?? [];
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(false);
  vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([]);
  m.user.findMany.mockResolvedValue([{ id: "alice", firstName: "Alice", lastName: "Ng" }]);
  m.instructorAssignment.findFirst.mockResolvedValue(null);
  seed();
});

const load = () => loadSharedWithMe({ userSub: VIEWER });

describe("loadSharedWithMe", () => {
  it("lists a personal note shared directly, flat, with who shared it and when", async () => {
    seed({ received: [received(page("note-1"), "2026-03-01T00:00:00Z")] });
    const items = await load();
    expect(items).toEqual([
      expect.objectContaining({
        type: "doc",
        id: "note-1",
        parentFolderId: null,
        href: "/documents/note-1",
        sharedBy: { name: "Alice Ng" },
        sharedAt: new Date("2026-03-01T00:00:00Z"),
        sharedWithMe: true,
      }),
    ]);
  });

  it("queries the viewer's direct shares and every group they belong to", async () => {
    vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([
      { id: "g1", archivedAt: null },
      { id: "g-archived", archivedAt: new Date() },
    ] as any);
    await load();
    const where = m.pageShare.findMany.mock.calls
      .map(([arg]: any) => arg.where)
      .find((w: any) => w.OR);
    expect(where.OR).toEqual([
      { principalType: "User", principalId: VIEWER },
      { principalType: "Group", principalId: { in: ["g1"] } },
    ]);
    expect(where.page.archivedAt).toBeNull();
  });

  it("lists a page shared through a group", async () => {
    vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([{ id: "g1", archivedAt: null }] as any);
    seed({ received: [received(page("via-group"), "2026-03-01T00:00:00Z")] });
    expect((await load()).map((i) => i.id)).toEqual(["via-group"]);
  });

  it("omits a page the viewer already sees through workspace membership", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const projectPage = page("proj-doc", { workspaceType: "Project", workspaceId: "p1", createdById: "alice" });
    seed({
      received: [
        received(projectPage, "2026-03-02T00:00:00Z"),
        received(page("note-1"), "2026-03-01T00:00:00Z"),
      ],
    });
    expect((await load()).map((i) => i.id)).toEqual(["note-1"]);
  });

  it("omits a public or lab-listed note, which is browsable without the share", async () => {
    seed({
      received: [
        received(page("listed", { labListing: "Listed" }), "2026-03-03T00:00:00Z"),
        received(page("public-link", { linkAccess: "Public" }), "2026-03-02T00:00:00Z"),
        received(page("private"), "2026-03-01T00:00:00Z"),
      ],
    });
    expect((await load()).map((i) => i.id)).toEqual(["private"]);
  });

  it("shows Core nothing for Lab and project pages, whose base access is already full", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    seed({
      received: [
        received(page("lab-doc", { workspaceType: "Lab", workspaceId: null }), "2026-03-02T00:00:00Z"),
        received(page("proj-doc", { workspaceType: "Project", workspaceId: "p1" }), "2026-03-01T00:00:00Z"),
      ],
    });
    expect(await load()).toEqual([]);
  });

  it("still shows Core a personal note, because Core has no bypass on Member pages", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    seed({ received: [received(page("note-1"), "2026-03-01T00:00:00Z")] });
    expect((await load()).map((i) => i.id)).toEqual(["note-1"]);
  });

  it("lists a lab page shared by name with a member who is not its creator", async () => {
    seed({
      received: [
        received(page("lab-doc", { workspaceType: "Lab", workspaceId: null }), "2026-03-01T00:00:00Z"),
      ],
    });
    expect((await load()).map((i) => i.id)).toEqual(["lab-doc"]);
  });

  it("sorts by share date, newest first", async () => {
    seed({
      received: [
        received(page("old"), "2026-01-01T00:00:00Z"),
        received(page("new"), "2026-03-01T00:00:00Z"),
        received(page("mid"), "2026-02-01T00:00:00Z"),
      ],
    });
    expect((await load()).map((i) => i.id)).toEqual(["new", "mid", "old"]);
  });

  it("keeps one row per page when two shares reach the viewer, using the latest", async () => {
    seed({
      received: [
        received(page("note-1"), "2026-03-01T00:00:00Z", "alice"),
        received(page("note-1"), "2026-01-01T00:00:00Z", "bob"),
      ],
    });
    const items = await load();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sharedAt: new Date("2026-03-01T00:00:00Z") });
  });

  it("falls back to a null sharer when the granting account is gone", async () => {
    m.user.findMany.mockResolvedValue([]);
    seed({ received: [received(page("note-1"), "2026-03-01T00:00:00Z", "deleted")] });
    expect((await load())[0]).toMatchObject({ sharedBy: null });
  });

  it("opens a whiteboard in the whiteboard editor", async () => {
    seed({ received: [received(page("wb", { kind: "Whiteboard" }), "2026-03-01T00:00:00Z")] });
    expect((await load())[0]).toMatchObject({ isWhiteboard: true, href: "/whiteboard/wb" });
  });

  it("never asks for folders, which would open onto children this flat space doesn't load", async () => {
    await load();
    const kinds = m.pageShare.findMany.mock.calls[0][0].where.page.kind.in;
    expect(kinds).not.toContain("Folder");
    expect(kinds).toContain("Notebook");
  });

  describe("shared by me", () => {
    const granted = (p: ReturnType<typeof page>, at: string): Granted => ({
      pageId: p.id,
      createdAt: new Date(at),
      page: p,
    });
    const own = (id: string) => page(id, { workspaceId: VIEWER, createdById: VIEWER });

    it("lists a page the viewer granted a share on, flagged sharedByMe", async () => {
      seed({ granted: [granted(own("mine-1"), "2026-03-01T00:00:00Z")] });
      expect(await load()).toEqual([
        expect.objectContaining({ id: "mine-1", sharedByMe: true, sharedBy: { name: "You" } }),
      ]);
    });

    it("does not flag a with-me page as sharedByMe unless the viewer also re-shared it", async () => {
      seed({ received: [received(page("note-1"), "2026-03-01T00:00:00Z")] });
      const [item] = await load();
      expect(item).toMatchObject({ sharedWithMe: true });
      expect(item).not.toHaveProperty("sharedByMe");
    });

    it("merges a re-shared page into one row carrying both flags", async () => {
      const p = page("note-1");
      seed({
        received: [received(p, "2026-03-01T00:00:00Z")],
        granted: [granted(p, "2026-03-05T00:00:00Z")],
        viewerShares: { "note-1": "Edit" },
      });
      const items = await load();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ sharedWithMe: true, sharedByMe: true, sharedBy: { name: "Alice Ng" } });
    });

    it("drops a granted page the viewer can no longer open", async () => {
      seed({ granted: [granted(page("lost"), "2026-03-01T00:00:00Z")] });
      expect(await load()).toEqual([]);
    });

    it("excludes shares the viewer made to themself", async () => {
      await load();
      const grantedWhere = m.pageShare.findMany.mock.calls
        .map(([arg]: any) => arg.where)
        .find((w: any) => w.createdById);
      expect(grantedWhere.createdById).toBe(VIEWER);
      expect(grantedWhere.NOT).toEqual({ principalType: "User", principalId: VIEWER });
    });
  });
});
