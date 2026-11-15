import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));
vi.mock("~/lib/roles", () => ({ isLabMember: vi.fn() }));
vi.mock("~/lib/groups.server", () => ({ listVisibleGroupsForUser: vi.fn() }));
vi.mock("~/lib/page-sharing.server", async () => {
  const { BadRequestError } = await import("~/lib/http-error");
  return {
    addPageShare: vi.fn(),
    listPageShares: vi.fn(),
    removePageShare: vi.fn(),
    SharePrincipalError: class SharePrincipalError extends BadRequestError {},
  };
});
vi.mock("~/lib/page-share-access.server", async () => {
  const { BadRequestError, ForbiddenError, NotFoundError } = await import("~/lib/http-error");
  return {
    requirePageShareManager: vi.fn(),
    setGeneralAccess: vi.fn(),
    setFolderScope: vi.fn(),
    notifyDocumentShared: vi.fn(),
    PageShareForbiddenError: class PageShareForbiddenError extends ForbiddenError {},
    PageShareNotFoundError: class PageShareNotFoundError extends NotFoundError {},
    GeneralAccessError: class GeneralAccessError extends BadRequestError {},
  };
});
vi.mock("~/drive/lib/page-audience.server", () => ({ describePageAudience: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { isLabMember } from "~/lib/roles";
import { listVisibleGroupsForUser } from "~/lib/groups.server";
import { listPageShares, addPageShare, removePageShare, SharePrincipalError } from "~/lib/page-sharing.server";
import {
  requirePageShareManager,
  setGeneralAccess,
  setFolderScope,
  notifyDocumentShared,
  PageShareForbiddenError,
  PageShareNotFoundError,
  GeneralAccessError,
} from "~/lib/page-share-access.server";
import { describePageAudience } from "~/drive/lib/page-audience.server";
import { action } from "../api.pages.$id.share";

const USER_ID = "user-1";
const CONTEXT = { page: { id: "page-1", title: "Plan" }, linkAccess: "Restricted" };
const SHARES = [{ id: "s1", principalType: "User", principalId: "u2", permission: "View", label: "Ada" }];

function run(intent: string, fields: Record<string, string> = {}, method = "POST") {
  const body = new FormData();
  body.set("intent", intent);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/api/pages/page-1/share", {
      method,
      ...(method === "POST" ? { body } : {}),
    }),
    params: { id: "page-1" },
    context: {},
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as never);
  vi.mocked(requirePageShareManager).mockResolvedValue(CONTEXT as never);
  vi.mocked(listPageShares).mockResolvedValue(SHARES as never);
  vi.mocked(describePageAudience).mockResolvedValue({ audience: null, inherited: null });
});

describe("POST /api/pages/:id/share state", () => {
  it("carries the inherited folder scope and the audience summary beside the shares", async () => {
    const inherited = {
      folderId: "folder-1",
      title: "Hiring",
      scopeKind: "Group",
      groupName: "Core",
      permission: "Edit",
    };
    const audience = {
      kind: "group",
      label: "Core",
      permission: "Edit",
      inheritedFrom: { id: "folder-1", title: "Hiring" },
    };
    vi.mocked(describePageAudience).mockResolvedValue({ audience, inherited } as never);

    const res = await run("state");
    expect(await res.json()).toEqual({
      ok: true,
      context: CONTEXT,
      shares: SHARES.map((s) => ({ ...s, viaMeeting: null })),
      audience,
      inherited,
    });
    expect(describePageAudience).toHaveBeenCalledWith(USER_ID, "page-1");
  });

  it("marks a share a meeting's roster created with the first meeting that justifies it", async () => {
    vi.mocked(listPageShares).mockResolvedValue([
      ...SHARES,
      { id: "s2", principalType: "User", principalId: "u3", permission: "Edit", label: "Grace" },
    ] as never);
    vi.mocked(prisma.meetingShareGrant.findMany).mockResolvedValue([
      { pageShareId: "s2", meeting: { title: "Weekly sync" } },
      { pageShareId: "s2", meeting: { title: "Retro" } },
    ] as never);

    const body = await (await run("state")).json();

    expect(body.shares.map((s: { id: string; viaMeeting: unknown }) => [s.id, s.viaMeeting])).toEqual([
      ["s1", null],
      ["s2", { meetingTitle: "Weekly sync" }],
    ]);
    expect(prisma.meetingShareGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pageShareId: { in: ["s1", "s2"] } } }),
    );
  });

  it("asks nothing of the database when nobody has the page shared", async () => {
    vi.mocked(listPageShares).mockResolvedValue([]);
    const body = await (await run("state")).json();
    expect(body.shares).toEqual([]);
    expect(prisma.page.findMany).not.toHaveBeenCalled();
    expect(prisma.meetingShareGrant.findMany).not.toHaveBeenCalled();
  });

  it("sends inherited: null when nothing governs the page", async () => {
    const body = await (await run("state")).json();
    expect(body.inherited).toBeNull();
    expect(body.audience).toBeNull();
  });

  it("stays behind the manager gate and computes no audience for a non-manager", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
    const res = await run("state");
    expect(res.status).toBe(403);
    expect(describePageAudience).not.toHaveBeenCalled();
  });
});

describe("POST /api/pages/:id/share — request gate", () => {
  it("rejects non-POST methods with 405", async () => {
    expect((await run("state", {}, "GET")).status).toBe(405);
  });

  it("returns the auth failure untouched for an unauthenticated caller", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);
    expect((await run("share-add", { principalId: "u2" })).status).toBe(401);
    expect(requirePageShareManager).not.toHaveBeenCalled();
  });

  it("400s an unknown intent", async () => {
    const res = await run("explode");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown action" });
  });

  it.each(["share-add", "share-change", "share-remove", "general-access", "folder-scope"])(
    "%s is refused for a non-manager and writes nothing",
    async (intent) => {
      vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
      const res = await run(intent, { principalId: "u2", shareId: "s1" });
      expect(res.status).toBe(403);
      expect(addPageShare).not.toHaveBeenCalled();
      expect(removePageShare).not.toHaveBeenCalled();
      expect(setGeneralAccess).not.toHaveBeenCalled();
      expect(setFolderScope).not.toHaveBeenCalled();
    },
  );

  it("404s a missing page", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareNotFoundError());
    expect((await run("state")).status).toBe(404);
  });

  it("rethrows unexpected errors instead of masking them", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new Error("db down"));
    await expect(run("state")).rejects.toThrow("db down");
  });
});

describe("POST /api/pages/:id/share — share-add / share-change", () => {
  beforeEach(() => {
    vi.mocked(addPageShare).mockResolvedValue({ ok: true, changed: true } as never);
  });

  it("400s when no principal is picked", async () => {
    const res = await run("share-add");
    expect(res.status).toBe(400);
    expect(addPageShare).not.toHaveBeenCalled();
  });

  it("grants a user the requested permission and notifies them with the page title", async () => {
    const res = await run("share-add", { principalType: "User", principalId: "u2", permission: "Edit" });
    expect(await res.json()).toEqual({ ok: true, changed: true });
    expect(addPageShare).toHaveBeenCalledWith("page-1", USER_ID, "User", "u2", "Edit");
    expect(notifyDocumentShared).toHaveBeenCalledWith({
      pageId: "page-1",
      pageTitle: "Plan",
      recipientUserId: "u2",
      actorId: USER_ID,
    });
  });

  it("treats an unknown permission as View and an unknown principal type as User", async () => {
    await run("share-change", { principalType: "Robot", principalId: "u2", permission: "Owner" });
    expect(addPageShare).toHaveBeenCalledWith("page-1", USER_ID, "User", "u2", "View");
  });

  it("does not notify for a group, an unchanged grant, or sharing with yourself", async () => {
    await run("share-add", { principalType: "Group", principalId: "g1" });
    expect(addPageShare).toHaveBeenLastCalledWith("page-1", USER_ID, "Group", "g1", "View");
    vi.mocked(addPageShare).mockResolvedValue({ ok: true, changed: false } as never);
    await run("share-add", { principalId: "u2" });
    vi.mocked(addPageShare).mockResolvedValue({ ok: true, changed: true } as never);
    await run("share-add", { principalId: USER_ID });
    expect(notifyDocumentShared).not.toHaveBeenCalled();
  });

  it("turns a rejected principal into a 400", async () => {
    vi.mocked(addPageShare).mockRejectedValue(new SharePrincipalError("Unknown user"));
    const res = await run("share-add", { principalId: "ghost" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown user" });
    expect(notifyDocumentShared).not.toHaveBeenCalled();
  });
});

describe("POST /api/pages/:id/share — share-remove, general-access, folder-scope", () => {
  it("removes the named share on the page", async () => {
    expect(await (await run("share-remove", { shareId: "s1" })).json()).toEqual({ ok: true });
    expect(removePageShare).toHaveBeenCalledWith("page-1", "s1");
  });

  it("general-access passes parsed values and falls back to Restricted/View on junk", async () => {
    vi.mocked(setGeneralAccess).mockResolvedValue({ linkAccess: "LabMembers", linkPermission: "Edit" } as never);
    const res = await run("general-access", { linkAccess: "LabMembers", linkPermission: "Edit" });
    expect(await res.json()).toEqual({ ok: true, linkAccess: "LabMembers", linkPermission: "Edit" });
    expect(setGeneralAccess).toHaveBeenCalledWith("page-1", USER_ID, { linkAccess: "LabMembers", linkPermission: "Edit" });

    await run("general-access", { linkAccess: "Everyone", linkPermission: "God" });
    expect(setGeneralAccess).toHaveBeenLastCalledWith("page-1", USER_ID, { linkAccess: "Restricted", linkPermission: "View" });
  });

  it("turns a refused general-access change into a 400", async () => {
    vi.mocked(setGeneralAccess).mockRejectedValue(new GeneralAccessError("Links can't grant full access"));
    const res = await run("general-access", { linkAccess: "Public", linkPermission: "FullAccess" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Links can't grant full access" });
  });

  it("folder-scope clears the scope for an unrecognised kind and defaults the permission to null", async () => {
    vi.mocked(setFolderScope).mockResolvedValue({ scopeKind: null } as never);
    await run("folder-scope", { scopeKind: "" });
    expect(setFolderScope).toHaveBeenCalledWith("page-1", USER_ID, {
      scopeKind: null,
      scopeGroupId: null,
      scopePermission: null,
    });
  });

  it("folder-scope passes a group scope with its permission", async () => {
    vi.mocked(setFolderScope).mockResolvedValue({ scopeKind: "Group" } as never);
    await run("folder-scope", { scopeKind: "Group", scopeGroupId: "g1", scopePermission: "Comment" });
    expect(setFolderScope).toHaveBeenCalledWith("page-1", USER_ID, {
      scopeKind: "Group",
      scopeGroupId: "g1",
      scopePermission: "Comment",
    });
  });
});

describe("POST /api/pages/:id/share — share-options", () => {
  beforeEach(() => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(listVisibleGroupsForUser).mockResolvedValue([{ id: "g1", name: "Core" }] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u2", firstName: "Grace", lastName: "Hopper" },
    ] as never);
  });

  it("is forbidden for non-lab-members and queries nothing", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    const res = await run("share-options", { q: "gr" });
    expect(res.status).toBe(403);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(listVisibleGroupsForUser).not.toHaveBeenCalled();
  });

  it("returns no members for a query under two characters, but still lists groups", async () => {
    const body = await (await run("share-options", { q: " g " })).json();
    expect(body).toEqual({ ok: true, members: [], groups: [{ id: "g1", label: "Core" }] });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("searches DALI members by name, excluding the caller, capped at 8", async () => {
    const body = await (await run("share-options", { q: "gra" })).json();
    expect(body.members).toEqual([{ id: "u2", label: "Grace Hopper" }]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 8,
        where: expect.objectContaining({
          id: { not: USER_ID },
          daliMember: { isNot: null },
        }),
      }),
    );
  });
});
