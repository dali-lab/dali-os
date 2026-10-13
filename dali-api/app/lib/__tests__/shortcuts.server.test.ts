import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    pageShare: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    groupDefinition: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    educationOffering: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
  getPageAccessBulk: vi.fn(),
  findGoverningScopeFor: vi.fn(),
  PAGE_ACCESS_SELECT: { id: true },
}));
vi.mock("~/lib/page-share-access.server", () => ({ canManageSharing: vi.fn() }));
vi.mock("~/lib/page-sharing.server", () => {
  class SharePrincipalError extends Error {}
  return { addPageShare: vi.fn(), SharePrincipalError };
});
vi.mock("~/lib/groups", () => ({ ensureProjectGroup: vi.fn(), ensureOfferingGroup: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isProjectMember: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/education/lib/access.server", () => ({ isOfferingManager: vi.fn() }));
vi.mock("~/lib/pages", () => ({ MAX_PAGE_DEPTH: 6, pageDepth: vi.fn() }));
vi.mock("~/lib/drive-receivers.server", () => ({ folderPath: vi.fn() }));
vi.mock("~/lib/page-move.server", () => ({ movePage: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db";
import { getPageAccess, getPageAccessBulk, findGoverningScopeFor } from "~/lib/pageAccess.server";
import { canManageSharing } from "~/lib/page-share-access.server";
import { addPageShare, SharePrincipalError } from "~/lib/page-sharing.server";
import { ensureProjectGroup, ensureOfferingGroup } from "~/lib/groups";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { isOfferingManager } from "~/education/lib/access.server";
import { pageDepth } from "~/lib/pages";
import { folderPath } from "~/lib/drive-receivers.server";
import { movePage } from "~/lib/page-move.server";
import {
  ShortcutError,
  grantPrincipalFor,
  createShortcut,
  deleteShortcut,
  placePage,
  swapPrimary,
  shortcutsOf,
  placementsOf,
  resolveShortcut,
  resolveShortcutTarget,
  type Dest,
} from "~/lib/shortcuts.server";

const m = prisma as any;

let rows: Record<string, Record<string, unknown>> = {};
/** Governing scope by folder id, for folders that sit under a scoped ancestor. */
let governing: Record<string, Record<string, unknown>> = {};

function folder(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    kind: "Folder",
    archivedAt: null,
    workspaceType: "Project",
    workspaceId: "projA",
    parentPageId: null,
    scopeKind: null,
    scopeGroupId: null,
    scopePermission: null,
    createdById: "creator",
    ...over,
  };
}
function target(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Kickoff notes",
    kind: "FreeForm",
    archivedAt: null,
    workspaceType: "Project",
    workspaceId: "projA",
    parentPageId: "origin",
    createdById: "owner",
    ...over,
  };
}
const put = (row: Record<string, unknown>) => {
  rows[row.id as string] = row;
};

const projDest: Dest = { workspaceType: "Project", workspaceId: "projA", parentPageId: "f1" };
const labDest: Dest = { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" };
const eduDest: Dest = { workspaceType: "EducationOffering", workspaceId: "off1", parentPageId: "f1" };

beforeEach(() => {
  vi.resetAllMocks();
  rows = {};
  governing = {};
  m.page.findUnique.mockImplementation(async ({ where }: any) => rows[where.id] ?? null);
  m.page.findFirst.mockResolvedValue(null);
  m.page.aggregate.mockResolvedValue({ _max: { position: 4 } });
  m.page.create.mockResolvedValue({ id: "s1" });
  m.pageShare.findUnique.mockResolvedValue(null);
  m.$transaction.mockResolvedValue([]);
  vi.mocked(findGoverningScopeFor).mockImplementation(
    async (row: any) => (governing[row.id] ?? (row.scopeKind ? row : null)) as any,
  );
  vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true, canComment: true });
  vi.mocked(getPageAccessBulk).mockImplementation(
    async (_u: string, pages: any[]) => new Map(pages.map((p) => [p.id, { canView: true, canEdit: true, canComment: true }])),
  );
  vi.mocked(canManageSharing).mockResolvedValue(true);
  vi.mocked(addPageShare).mockResolvedValue({ ok: true, alreadyShared: false, changed: true });
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(true);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(isOfferingManager).mockResolvedValue(true);
  vi.mocked(pageDepth).mockResolvedValue(1);
  vi.mocked(movePage).mockResolvedValue({ ok: true, clearedReceivers: [] });
  m.groupDefinition.findUnique.mockImplementation(async ({ where }: any) => ({
    id: `group-of-${where.systemKey}`,
    archivedAt: null,
  }));
  put(folder("f1"));
  put(target());
});

describe("grantPrincipalFor — who a shortcut shares with", () => {
  it("a Group-scoped folder shares with that group at the scope's permission", async () => {
    put(folder("f1", { scopeKind: "Group", scopeGroupId: "g1", scopePermission: "View" }));
    expect(await grantPrincipalFor(projDest)).toEqual({ principalType: "Group", principalId: "g1", permission: "View" });
  });

  it("a Group-scoped folder with no stated permission grants Edit, which is what the scope itself gives its members", async () => {
    put(folder("f1", { workspaceType: "Lab", workspaceId: null, scopeKind: "Group", scopeGroupId: "g1" }));
    expect(await grantPrincipalFor(labDest)).toEqual({ principalType: "Group", principalId: "g1", permission: "Edit" });
  });

  it("a folder under a scoped ancestor shares with the ancestor's group", async () => {
    put(folder("f1", { workspaceType: "Lab", workspaceId: null, parentPageId: "scoped" }));
    governing.f1 = folder("scoped", { scopeKind: "Group", scopeGroupId: "g9", scopePermission: "Comment" });
    expect(await grantPrincipalFor(labDest)).toEqual({ principalType: "Group", principalId: "g9", permission: "Comment" });
  });

  it("a Private folder shares with the governing folder's creator as a user", async () => {
    put(folder("f1", { workspaceType: "Lab", workspaceId: null, scopeKind: "Private", createdById: "kim" }));
    expect(await grantPrincipalFor(labDest)).toEqual({ principalType: "User", principalId: "kim", permission: "Edit" });
  });

  it("a Lab-scoped folder grants nothing", async () => {
    put(folder("f1", { workspaceType: "Lab", workspaceId: null, scopeKind: "Lab" }));
    expect(await grantPrincipalFor(labDest)).toBeNull();
  });

  it("an unscoped project folder shares with the project's group at Edit", async () => {
    expect(await grantPrincipalFor(projDest)).toEqual({
      principalType: "Group",
      principalId: "group-of-project:projA",
      permission: "Edit",
    });
  });

  it("the top level of a project shares with the project's group", async () => {
    expect(await grantPrincipalFor({ ...projDest, parentPageId: null })).toMatchObject({
      principalId: "group-of-project:projA",
    });
  });

  it("creates the project group when it does not exist yet", async () => {
    m.groupDefinition.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "fresh", archivedAt: null });
    m.project.findUnique.mockResolvedValue({ name: "Cortex" });

    expect(await grantPrincipalFor(projDest)).toMatchObject({ principalId: "fresh" });
    expect(ensureProjectGroup).toHaveBeenCalledWith("projA", "Cortex");
  });

  it("an archived project group grants nothing", async () => {
    m.groupDefinition.findUnique.mockResolvedValue({ id: "old", archivedAt: new Date() });
    expect(await grantPrincipalFor(projDest)).toBeNull();
  });

  it("an offering folder shares with the offering's group at View", async () => {
    put(folder("f1", { workspaceType: "EducationOffering", workspaceId: "off1" }));
    expect(await grantPrincipalFor(eduDest)).toEqual({
      principalType: "Group",
      principalId: "group-of-offering:off1",
      permission: "View",
    });
  });

  it("creates the offering group when it does not exist yet", async () => {
    put(folder("f1", { workspaceType: "EducationOffering", workspaceId: "off1" }));
    m.groupDefinition.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "fresh", archivedAt: null });
    m.educationOffering.findUnique.mockResolvedValue({ title: "Intro" });

    expect(await grantPrincipalFor(eduDest)).toMatchObject({ principalId: "fresh" });
    expect(ensureOfferingGroup).toHaveBeenCalledWith("off1", "Intro");
  });

  it("an unscoped Lab folder grants nothing, and neither does the Lab top level", async () => {
    put(folder("f1", { workspaceType: "Lab", workspaceId: null }));
    expect(await grantPrincipalFor(labDest)).toBeNull();
    expect(await grantPrincipalFor({ ...labDest, parentPageId: null })).toBeNull();
  });

  it("My Drive is not a destination", async () => {
    await expect(
      grantPrincipalFor({ workspaceType: "Member", workspaceId: "u1", parentPageId: null }),
    ).rejects.toMatchObject({ name: "ShortcutError" });
  });

  it("refuses a Lab destination that names a workspace, and a project one that names none", async () => {
    await expect(grantPrincipalFor({ ...labDest, workspaceId: "projA" })).rejects.toBeInstanceOf(ShortcutError);
    await expect(grantPrincipalFor({ ...projDest, workspaceId: null })).rejects.toBeInstanceOf(ShortcutError);
  });

  it("refuses a folder from another workspace, a trashed one, a missing one, and a non-folder", async () => {
    put(folder("f1", { workspaceId: "projB" }));
    await expect(grantPrincipalFor(projDest)).rejects.toMatchObject({ status: 404 });
    put(folder("f1", { archivedAt: new Date() }));
    await expect(grantPrincipalFor(projDest)).rejects.toMatchObject({ status: 404 });
    delete rows.f1;
    await expect(grantPrincipalFor(projDest)).rejects.toMatchObject({ status: 404 });
    put(folder("f1", { kind: "FreeForm" }));
    await expect(grantPrincipalFor(projDest)).rejects.toMatchObject({ status: 400 });
  });
});

describe("createShortcut", () => {
  const run = (dest: Dest = projDest) => createShortcut({ targetPageId: "t1", dest, actorId: "actor" });

  it("creates a bodyless shortcut titled like the target, last in the folder", async () => {
    await run();

    expect(m.page.create).toHaveBeenCalledWith({
      data: {
        workspaceType: "Project",
        workspaceId: "projA",
        parentPageId: "f1",
        title: "Kickoff notes",
        kind: "Shortcut",
        targetPageId: "t1",
        position: 5,
        createdById: "actor",
        linkAccess: "Restricted",
        linkPermission: "View",
      },
      select: { id: true },
    });
  });

  it("is listed to the whole lab when it sits in an unscoped Lab folder, and restricted inside a scope", async () => {
    put(folder("f1", { workspaceType: "Lab", workspaceId: null }));
    await run(labDest);
    expect(m.page.create.mock.calls[0][0].data).toMatchObject({ linkAccess: "LabMembers", linkPermission: "View" });

    put(folder("f1", { workspaceType: "Lab", workspaceId: null, scopeKind: "Group", scopeGroupId: "g1" }));
    await run(labDest);
    expect(m.page.create.mock.calls[1][0].data).toMatchObject({ linkAccess: "Restricted" });
  });

  it("shares the target with the folder's audience and records the share it made", async () => {
    m.pageShare.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "share-1" });

    const result = await run();

    expect(addPageShare).toHaveBeenCalledWith("t1", "actor", "Group", "group-of-project:projA", "Edit");
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { grantShareId: "share-1" } });
    expect(result).toEqual({ shortcutId: "s1", created: true, grantShareId: "share-1", grantDeclined: false });
  });

  it("records nothing when the audience already has a share, so removing the chip can't delete a hand-made one", async () => {
    m.pageShare.findUnique.mockResolvedValue({ id: "hand-made" });

    const result = await run();

    expect(addPageShare).not.toHaveBeenCalled();
    expect(m.page.update).not.toHaveBeenCalled();
    expect(result).toEqual({ shortcutId: "s1", created: true, grantShareId: null, grantDeclined: false });
  });

  it("creates the shortcut with no grant and says so when the actor can't manage the target's sharing", async () => {
    vi.mocked(canManageSharing).mockResolvedValue(false);

    const result = await run();

    expect(addPageShare).not.toHaveBeenCalled();
    expect(result).toEqual({ shortcutId: "s1", created: true, grantShareId: null, grantDeclined: true });
  });

  it("declines when the audience group can no longer be shared with", async () => {
    vi.mocked(addPageShare).mockRejectedValue(new SharePrincipalError("That group is archived"));

    expect(await run()).toMatchObject({ created: true, grantShareId: null, grantDeclined: true });
  });

  it("propagates an unexpected sharing failure", async () => {
    vi.mocked(addPageShare).mockRejectedValue(new Error("db down"));
    await expect(run()).rejects.toThrow("db down");
  });

  it("grants nothing for an unscoped Lab folder and does not call that a decline", async () => {
    put(folder("f1", { workspaceType: "Lab", workspaceId: null }));
    vi.mocked(canManageSharing).mockResolvedValue(false);

    const result = await run(labDest);

    expect(addPageShare).not.toHaveBeenCalled();
    expect(result.grantDeclined).toBe(false);
  });

  it("does not share a Private folder's creator with themselves when they are the actor", async () => {
    put(folder("f1", { workspaceType: "Lab", workspaceId: null, scopeKind: "Private", createdById: "actor" }));

    const result = await run(labDest);

    expect(addPageShare).not.toHaveBeenCalled();
    expect(result.grantDeclined).toBe(false);
  });

  it("shares with a Private folder's creator when someone else files into it", async () => {
    put(folder("f1", { workspaceType: "Lab", workspaceId: null, scopeKind: "Private", createdById: "kim" }));
    m.pageShare.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "share-2" });

    await run(labDest);

    expect(addPageShare).toHaveBeenCalledWith("t1", "actor", "User", "kim", "Edit");
  });

  it("returns the shortcut that is already in that folder and changes nothing", async () => {
    m.page.findFirst.mockResolvedValue({ id: "existing", grantShareId: "g" });

    const result = await run();

    expect(m.page.create).not.toHaveBeenCalled();
    expect(addPageShare).not.toHaveBeenCalled();
    expect(result).toEqual({ shortcutId: "existing", created: false, grantShareId: "g", grantDeclined: false });
  });

  it("re-finds the winner when two requests race on the unique index", async () => {
    m.page.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner", grantShareId: null });
    m.page.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const result = await run();

    expect(result).toEqual({ shortcutId: "winner", created: false, grantShareId: null, grantDeclined: false });
    expect(addPageShare).not.toHaveBeenCalled();
  });

  it("rethrows a unique violation that no shortcut explains", async () => {
    m.page.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    await expect(run()).rejects.toThrow("unique");
  });

  it("rethrows any other create failure", async () => {
    m.page.create.mockRejectedValue(new Error("db down"));
    await expect(run()).rejects.toThrow("db down");
  });

  it("refuses a missing, trashed, or shortcut target", async () => {
    delete rows.t1;
    await expect(run()).rejects.toMatchObject({ status: 404 });
    put(target({ archivedAt: new Date() }));
    await expect(run()).rejects.toMatchObject({ status: 404 });
    put(target({ kind: "Shortcut" }));
    await expect(run()).rejects.toMatchObject({ status: 400 });
    expect(m.page.create).not.toHaveBeenCalled();
  });

  it("refuses when the actor can't view the target, without revealing it exists", async () => {
    vi.mocked(getPageAccess).mockImplementation(async (_u: string, page: any) =>
      page.id === "t1"
        ? { canView: false, canEdit: false, canComment: false }
        : { canView: true, canEdit: true, canComment: true },
    );
    await expect(run()).rejects.toMatchObject({ status: 404, message: "Document not found" });
  });

  it("refuses when the actor can't edit the destination folder", async () => {
    vi.mocked(getPageAccess).mockImplementation(async (_u: string, page: any) =>
      page === "f1"
        ? { canView: true, canEdit: false, canComment: false }
        : { canView: true, canEdit: true, canComment: true },
    );
    await expect(run()).rejects.toMatchObject({ status: 403 });
    expect(m.page.create).not.toHaveBeenCalled();
  });

  it("refuses a folder nested past the depth limit", async () => {
    vi.mocked(pageDepth).mockResolvedValue(6);
    await expect(run()).rejects.toMatchObject({ status: 400 });
  });

  it("refuses My Drive", async () => {
    await expect(run({ workspaceType: "Member", workspaceId: "u", parentPageId: null })).rejects.toBeInstanceOf(
      ShortcutError,
    );
  });

  describe("at the top level of a workspace", () => {
    it("lets any lab member file into the Lab drive, and no one else", async () => {
      await run({ ...labDest, parentPageId: null });
      expect(m.page.create).toHaveBeenCalledTimes(1);

      vi.mocked(isLabMember).mockResolvedValue(false);
      await expect(run({ ...labDest, parentPageId: null })).rejects.toMatchObject({ status: 403 });
    });

    it("lets Core or a project member file into a project, and no one else", async () => {
      await run({ ...projDest, parentPageId: null });
      expect(m.page.create).toHaveBeenCalledTimes(1);

      vi.mocked(isProjectMember).mockResolvedValue(false);
      await expect(run({ ...projDest, parentPageId: null })).rejects.toMatchObject({ status: 403 });
      vi.mocked(isCore).mockResolvedValue(true);
      await run({ ...projDest, parentPageId: null });
      expect(m.page.create).toHaveBeenCalledTimes(2);
    });

    it("lets an offering's instructors file into it, and no one else", async () => {
      await run({ ...eduDest, parentPageId: null });
      expect(isOfferingManager).toHaveBeenCalledWith("actor", "off1");

      vi.mocked(isOfferingManager).mockResolvedValue(false);
      await expect(run({ ...eduDest, parentPageId: null })).rejects.toMatchObject({ status: 403 });
    });
  });
});

describe("deleteShortcut", () => {
  const shortcut = (over: Record<string, unknown> = {}) => ({
    id: "s1",
    kind: "Shortcut",
    workspaceType: "Project",
    workspaceId: "projA",
    parentPageId: "f1",
    targetPageId: "t1",
    grantShareId: "share-1",
    ...over,
  });

  it("deletes the row and only the share it created", async () => {
    put(shortcut());
    m.page.delete.mockReturnValue("delete-page");
    m.pageShare.deleteMany.mockReturnValue("delete-share");

    await deleteShortcut("s1", "actor");

    expect(m.page.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
    expect(m.pageShare.deleteMany).toHaveBeenCalledWith({ where: { id: "share-1" } });
    expect(m.$transaction).toHaveBeenCalledWith(["delete-page", "delete-share"]);
  });

  it("touches no share when the shortcut recorded none", async () => {
    put(shortcut({ grantShareId: null }));

    await deleteShortcut("s1", "actor");

    expect(m.pageShare.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a shortcut or does not exist", async () => {
    put(shortcut({ kind: "FreeForm" }));
    await expect(deleteShortcut("s1", "actor")).rejects.toMatchObject({ status: 404 });
    await expect(deleteShortcut("nope", "actor")).rejects.toMatchObject({ status: 404 });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an actor who can't edit the shortcut's folder", async () => {
    put(shortcut());
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false, canComment: false });
    await expect(deleteShortcut("s1", "actor")).rejects.toMatchObject({ status: 403 });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("applies the top-level rule to a shortcut with no folder", async () => {
    put(shortcut({ parentPageId: null }));
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(deleteShortcut("s1", "actor")).rejects.toMatchObject({ status: 403 });
  });
});

describe("placePage", () => {
  const dests: Dest[] = [
    { workspaceType: "Project", workspaceId: "projA", parentPageId: "f1" },
    { workspaceType: "Lab", workspaceId: null, parentPageId: "f2" },
    { workspaceType: "EducationOffering", workspaceId: "off1", parentPageId: "f3" },
  ];

  beforeEach(() => {
    put(folder("f2", { workspaceType: "Lab", workspaceId: null }));
    put(folder("f3", { workspaceType: "EducationOffering", workspaceId: "off1" }));
    put(target({ workspaceType: "Lab", workspaceId: null, parentPageId: "elsewhere" }));
    m.page.create.mockResolvedValueOnce({ id: "s-lab" }).mockResolvedValueOnce({ id: "s-edu" });
  });

  const run = (over: Partial<Parameters<typeof placePage>[0]> = {}) =>
    placePage({ pageId: "t1", destinations: dests, primaryIndex: 0, actorId: "actor", ...over });

  it("moves the page to the primary and leaves a shortcut in each other destination", async () => {
    const result = await run();

    expect(movePage).toHaveBeenCalledTimes(1);
    expect(movePage).toHaveBeenCalledWith({
      pageId: "t1",
      userId: "actor",
      request: undefined,
      input: { parentPageId: "f1", workspaceType: "Project", workspaceId: "projA" },
    });
    expect(m.page.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ primaryId: "t1", shortcutIds: ["s-lab", "s-edu"], declined: 0 });
  });

  it("honours a primary other than the first", async () => {
    await run({ primaryIndex: 2 });

    expect(movePage).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { parentPageId: "f3", workspaceType: "EducationOffering", workspaceId: "off1" },
      }),
    );
    expect(m.page.create.mock.calls.map((c: any) => c[0].data.parentPageId)).toEqual(["f1", "f2"]);
  });

  it("counts the shortcuts whose grant was declined", async () => {
    vi.mocked(canManageSharing).mockResolvedValue(false);
    expect((await run()).declined).toBe(1);
  });

  it("does not move a page that is already in the primary folder", async () => {
    put(target({ workspaceType: "Project", workspaceId: "projA", parentPageId: "f1" }));
    await run();
    expect(movePage).not.toHaveBeenCalled();
    expect(m.page.create).toHaveBeenCalledTimes(2);
  });

  it("drops repeated destinations and one equal to the primary", async () => {
    const result = await run({ destinations: [dests[0], dests[1], { ...dests[1] }, { ...dests[0] }] });
    expect(m.page.create).toHaveBeenCalledTimes(1);
    expect(result.shortcutIds).toEqual(["s-lab"]);
  });

  it("with one destination just moves the page", async () => {
    const result = await run({ destinations: [dests[0]] });
    expect(movePage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ primaryId: "t1", shortcutIds: [], declined: 0 });
  });

  it("checks every shortcut destination before moving anything", async () => {
    vi.mocked(getPageAccess).mockImplementation(async (_u: string, page: any) => ({
      canView: true,
      canEdit: page !== "f3",
      canComment: true,
    }));
    await expect(run()).rejects.toMatchObject({ status: 403 });
    expect(movePage).not.toHaveBeenCalled();
    expect(m.page.create).not.toHaveBeenCalled();
  });

  it("surfaces the move's refusal and files no shortcuts", async () => {
    vi.mocked(movePage).mockResolvedValue({ ok: false, status: 403, error: "You can't move this document" });
    await expect(run()).rejects.toMatchObject({ status: 403, message: "You can't move this document" });
    expect(m.page.create).not.toHaveBeenCalled();
  });

  it("refuses an out-of-range primary, a shortcut, a trashed page and My Drive", async () => {
    await expect(run({ primaryIndex: 3 })).rejects.toBeInstanceOf(ShortcutError);
    put(target({ kind: "Shortcut" }));
    await expect(run()).rejects.toBeInstanceOf(ShortcutError);
    put(target({ archivedAt: new Date() }));
    await expect(run()).rejects.toMatchObject({ status: 404 });
    put(target());
    await expect(
      run({ destinations: [{ workspaceType: "Member", workspaceId: "u", parentPageId: null }], primaryIndex: 0 }),
    ).rejects.toBeInstanceOf(ShortcutError);
    expect(movePage).not.toHaveBeenCalled();
  });
});

describe("swapPrimary", () => {
  beforeEach(() => {
    put(target({ workspaceType: "Project", workspaceId: "projA", parentPageId: "f1" }));
    put(folder("f2", { workspaceType: "Lab", workspaceId: null, scopeKind: "Group", scopeGroupId: "g1" }));
    put({
      id: "s1",
      kind: "Shortcut",
      archivedAt: null,
      targetPageId: "t1",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "f2",
    });
    m.page.delete.mockReturnValue("delete-shortcut");
    m.page.create.mockReturnValue("create-shortcut");
    m.pageShare.create.mockReturnValue("create-share");
  });

  it("moves the page into the shortcut's folder and leaves a granted shortcut in the old one, in one transaction", async () => {
    m.page.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "left" });

    const result = await swapPrimary("t1", "s1", "actor");

    const call = vi.mocked(movePage).mock.calls[0][0];
    expect(call.input).toEqual({ parentPageId: "f2", workspaceType: "Lab", workspaceId: null });
    expect(call.extraOps).toEqual(["delete-shortcut", "create-share", "create-shortcut"]);
    const share = m.pageShare.create.mock.calls[0][0].data;
    expect(share).toMatchObject({
      pageId: "t1",
      principalType: "Group",
      principalId: "group-of-project:projA",
      permission: "Edit",
      createdById: "actor",
    });
    expect(m.page.create.mock.calls[0][0].data).toMatchObject({
      workspaceType: "Project",
      workspaceId: "projA",
      parentPageId: "f1",
      kind: "Shortcut",
      targetPageId: "t1",
      title: "Kickoff notes",
      grantShareId: share.id,
    });
    expect(result).toEqual({ primaryId: "t1", shortcutId: "left" });
  });

  it("leaves a shortcut with no grant when the old folder's audience is already shared", async () => {
    m.pageShare.findUnique.mockResolvedValue({ id: "hand-made" });

    await swapPrimary("t1", "s1", "actor");

    expect(m.pageShare.create).not.toHaveBeenCalled();
    expect(vi.mocked(movePage).mock.calls[0][0].extraOps).toEqual(["delete-shortcut", "create-shortcut"]);
    expect(m.page.create.mock.calls[0][0].data.grantShareId).toBeNull();
  });

  it("leaves a shortcut with no grant when the actor can't manage sharing", async () => {
    vi.mocked(canManageSharing).mockResolvedValue(false);

    await swapPrimary("t1", "s1", "actor");

    expect(m.pageShare.create).not.toHaveBeenCalled();
    expect(m.page.create.mock.calls[0][0].data.grantShareId).toBeNull();
  });

  it("leaves no second shortcut when the old folder already holds one", async () => {
    m.page.findFirst.mockResolvedValue({ id: "already" });

    await swapPrimary("t1", "s1", "actor");

    expect(vi.mocked(movePage).mock.calls[0][0].extraOps).toEqual(["delete-shortcut"]);
  });

  it("changes nothing when the move is refused", async () => {
    vi.mocked(movePage).mockResolvedValue({ ok: false, status: 403, error: "You can't move this document" });
    await expect(swapPrimary("t1", "s1", "actor")).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a shortcut that points elsewhere, is trashed, or is not a shortcut", async () => {
    put({ ...rows.s1, targetPageId: "other" });
    await expect(swapPrimary("t1", "s1", "actor")).rejects.toMatchObject({ status: 404 });
    put({ ...rows.s1, targetPageId: "t1", archivedAt: new Date() });
    await expect(swapPrimary("t1", "s1", "actor")).rejects.toMatchObject({ status: 404 });
    put({ ...rows.s1, archivedAt: null, kind: "FreeForm" });
    await expect(swapPrimary("t1", "s1", "actor")).rejects.toMatchObject({ status: 404 });
    expect(movePage).not.toHaveBeenCalled();
  });

  it("refuses to leave a shortcut in My Drive", async () => {
    put(target({ workspaceType: "Member", workspaceId: "u1", parentPageId: null }));
    await expect(swapPrimary("t1", "s1", "actor")).rejects.toBeInstanceOf(ShortcutError);
    expect(movePage).not.toHaveBeenCalled();
  });
});

describe("shortcutsOf", () => {
  it("lists each visible shortcut with its folder path", async () => {
    m.page.findMany.mockResolvedValue([
      { id: "s1", workspaceType: "Project", workspaceId: "projA", parentPageId: "f1" },
      { id: "s2", workspaceType: "Lab", workspaceId: null, parentPageId: null },
      { id: "s3", workspaceType: "Lab", workspaceId: null, parentPageId: "hidden" },
    ]);
    vi.mocked(getPageAccessBulk).mockResolvedValue(
      new Map([
        ["s1", { canView: true, canEdit: false, canComment: false }],
        ["s2", { canView: true, canEdit: false, canComment: false }],
        ["s3", { canView: false, canEdit: false, canComment: false }],
      ]),
    );
    vi.mocked(folderPath).mockResolvedValue([
      { id: "root", title: "Core" },
      { id: "f1", title: "Check-ins" },
    ]);

    expect(await shortcutsOf("t1", "viewer")).toEqual([
      {
        shortcutId: "s1",
        workspaceType: "Project",
        workspaceId: "projA",
        folderId: "f1",
        path: [
          { id: "root", title: "Core" },
          { id: "f1", title: "Check-ins" },
        ],
      },
      { shortcutId: "s2", workspaceType: "Lab", workspaceId: null, folderId: null, path: [] },
    ]);
    expect(m.page.findMany.mock.calls[0][0].where).toEqual({ kind: "Shortcut", targetPageId: "t1", archivedAt: null });
  });
});

describe("placementsOf", () => {
  beforeEach(() => {
    vi.mocked(folderPath).mockResolvedValue([{ id: "origin", title: "Meetings" }]);
    m.page.findMany.mockResolvedValue([{ id: "s1", workspaceType: "Lab", workspaceId: null, parentPageId: null }]);
  });

  it("returns the page's own place and its visible shortcuts", async () => {
    expect(await placementsOf("t1", "viewer")).toEqual({
      primary: {
        workspaceType: "Project",
        workspaceId: "projA",
        folderId: "origin",
        path: [{ id: "origin", title: "Meetings" }],
      },
      shortcuts: [{ shortcutId: "s1", workspaceType: "Lab", workspaceId: null, folderId: null, path: [] }],
    });
  });

  it("gives a top-level page an empty path", async () => {
    put(target({ parentPageId: null }));
    expect((await placementsOf("t1", "viewer")).primary).toEqual({
      workspaceType: "Project",
      workspaceId: "projA",
      folderId: null,
      path: [],
    });
  });

  it("is 404 for a page the viewer can't see, without listing anything", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: false, canEdit: false, canComment: false });
    await expect(placementsOf("t1", "viewer")).rejects.toMatchObject({ status: 404 });
    expect(m.page.findMany).not.toHaveBeenCalled();
  });

  it("is 404 for a missing, trashed or shortcut page", async () => {
    await expect(placementsOf("nope", "viewer")).rejects.toMatchObject({ status: 404 });
    put(target({ archivedAt: new Date() }));
    await expect(placementsOf("t1", "viewer")).rejects.toMatchObject({ status: 404 });
    put(target({ kind: "Shortcut" }));
    await expect(placementsOf("t1", "viewer")).rejects.toMatchObject({ status: 404 });
  });
});

describe("resolveShortcut", () => {
  const shortcutTo = (targetPage: Record<string, unknown> | null) =>
    m.page.findUnique.mockResolvedValue({ kind: "Shortcut", targetPage });

  it("points a shortcut at its target's own URL", async () => {
    shortcutTo({ id: "t1", kind: "FreeForm", archivedAt: null });
    expect(await resolveShortcutTarget("s1")).toEqual({ targetId: "t1", targetKind: "FreeForm", href: "/documents/t1" });
    shortcutTo({ id: "w1", kind: "Whiteboard", archivedAt: null });
    expect(await resolveShortcutTarget("s1")).toMatchObject({ href: "/whiteboard/w1" });
    shortcutTo({ id: "n1", kind: "Notebook", archivedAt: null });
    expect(await resolveShortcutTarget("s1")).toMatchObject({ href: "/documents/n1" });
  });

  it("resolves nothing for a page that is not a shortcut or has lost its target", async () => {
    m.page.findUnique.mockResolvedValue({ kind: "FreeForm", targetPage: null });
    expect(await resolveShortcutTarget("p")).toBeNull();
    shortcutTo(null);
    expect(await resolveShortcutTarget("s1")).toBeNull();
    m.page.findUnique.mockResolvedValue(null);
    expect(await resolveShortcut("s1", "viewer")).toBeNull();
  });

  it("opens when the viewer can see a live target", async () => {
    shortcutTo({ id: "t1", kind: "FreeForm", archivedAt: null });
    expect(await resolveShortcut("s1", "viewer")).toEqual({
      targetId: "t1",
      targetKind: "FreeForm",
      href: "/documents/t1",
      canOpen: true,
      originalInTrash: false,
    });
  });

  it("can't open a target the viewer has no access to", async () => {
    shortcutTo({ id: "t1", kind: "FreeForm", archivedAt: null });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: false, canEdit: false, canComment: false });
    expect(await resolveShortcut("s1", "viewer")).toMatchObject({ canOpen: false, originalInTrash: false });
  });

  it("marks a trashed original and does not open it", async () => {
    shortcutTo({ id: "t1", kind: "FreeForm", archivedAt: new Date() });
    expect(await resolveShortcut("s1", "viewer")).toMatchObject({ canOpen: false, originalInTrash: true });
    expect(getPageAccess).toHaveBeenCalledWith("viewer", expect.anything(), undefined, { includeArchived: true });
  });
});
