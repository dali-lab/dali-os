import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    projectFile: { findMany: vi.fn(), updateMany: vi.fn() },
    signingDocument: { count: vi.fn() },
    rubric: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
  isLabMember: vi.fn(),
}));
vi.mock("~/education/lib/access.server", () => ({ isOfferingManager: vi.fn() }));
vi.mock("~/lib/page-share-access.server", () => ({ canManageSharing: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/pages", async (importActual) => ({
  ...(await importActual<typeof import("~/lib/pages")>()),
  collectSubtree: vi.fn(),
}));
vi.mock("~/lib/drive-receivers.server", () => ({ clearTypeIfLeavingRoot: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/notebooks.server", () => ({
  addToNotebook: vi.fn(),
  loadManageableNotebook: vi.fn(),
  notebookErrorResponse: vi.fn(),
}));
vi.mock("~/lib/page-ancestry.server", async (importActual) => ({
  ...(await importActual<typeof import("~/lib/page-ancestry.server")>()),
  loadAncestorChain: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isLabMember } from "~/lib/roles";
import { canManageSharing } from "~/lib/page-share-access.server";
import { logAuditEvent } from "~/lib/audit";
import { collectSubtree, MAX_PAGE_DEPTH } from "~/lib/pages";
import { clearTypeIfLeavingRoot } from "~/lib/drive-receivers.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { addToNotebook, loadManageableNotebook, notebookErrorResponse } from "~/lib/notebooks.server";
import { loadAncestorChain, type ChainRow } from "~/lib/page-ancestry.server";
import { movePage, type MovePageBody } from "~/lib/page-move.server";

const m = prisma as any;

const sourcePage = (over: Record<string, unknown> = {}) => ({
  id: "page",
  workspaceType: "Lab",
  workspaceId: null,
  kind: "FreeForm",
  folderType: null,
  archivedAt: null,
  createdById: "u1",
  partnerVisible: false,
  publicVisible: false,
  projectAsOverview: null,
  projectAsPRD: null,
  ...over,
});

const ancestor = (id: string, parentPageId: string | null, over: Partial<ChainRow> = {}): ChainRow => ({
  id,
  title: id,
  parentPageId,
  scopeKind: null,
  scopeGroupId: null,
  scopePermission: null,
  createdById: null,
  workspaceType: "Lab",
  workspaceId: null,
  kind: "Folder",
  archivedAt: null,
  ...over,
});

// dest -> mid -> top, nearest first.
const destChain = (over: Partial<ChainRow> = {}) => [
  ancestor("dest", "mid", over),
  ancestor("mid", "top"),
  ancestor("top", null),
];

// A straight chain of n rows: dest at depth n - 1.
const chainDown = (n: number) =>
  Array.from({ length: n }, (_, i) => ancestor(i === 0 ? "dest" : `a${i}`, i === n - 1 ? null : `a${i + 1}`));

const move = (body: Partial<MovePageBody> = {}, extra: Record<string, unknown> = {}) =>
  movePage({ pageId: "page", userId: "u1", input: { parentPageId: null, ...body } as MovePageBody, ...extra });

const updateCalls = () => m.page.update.mock.calls.map(([arg]: any) => arg);

beforeEach(() => {
  vi.resetAllMocks();
  m.page.findUnique.mockResolvedValue(sourcePage());
  m.page.findMany.mockResolvedValue([]);
  m.page.aggregate.mockResolvedValue({ _max: { position: null } });
  m.page.update.mockImplementation((arg: unknown) => ({ op: "page.update", arg }));
  m.page.updateMany.mockImplementation((arg: unknown) => ({ op: "page.updateMany", arg }));
  m.projectFile.findMany.mockResolvedValue([]);
  m.projectFile.updateMany.mockImplementation((arg: unknown) => ({ op: "projectFile.updateMany", arg }));
  m.signingDocument.count.mockResolvedValue(0);
  m.rubric.count.mockResolvedValue(0);
  m.$transaction.mockResolvedValue([]);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(canManageSharing).mockResolvedValue(true);
  vi.mocked(collectSubtree).mockResolvedValue({ ids: [], height: 0 });
  vi.mocked(clearTypeIfLeavingRoot).mockResolvedValue([]);
  vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true, canComment: true } as never);
  vi.mocked(loadAncestorChain).mockResolvedValue(destChain());
});

describe("movePage: position", () => {
  it("appends with one aggregate and renumbers nobody when no position is requested", async () => {
    m.page.aggregate.mockResolvedValue({ _max: { position: 4 } });

    const result = await move({ parentPageId: "dest" });

    expect(result).toEqual({ ok: true, clearedReceivers: [] });
    expect(m.page.aggregate).toHaveBeenCalledTimes(1);
    expect(m.page.aggregate).toHaveBeenCalledWith({
      where: {
        workspaceType: "Lab",
        workspaceId: null,
        parentPageId: "dest",
        archivedAt: null,
        id: { not: "page" },
      },
      _max: { position: true },
    });
    expect(m.page.findMany).not.toHaveBeenCalled();
    expect(updateCalls()).toEqual([{ where: { id: "page" }, data: { parentPageId: "dest", position: 5 } }]);
  });

  it("puts the page first in an empty destination", async () => {
    await move({ parentPageId: null });
    expect(updateCalls()[0].data).toMatchObject({ parentPageId: null, position: 0 });
  });

  it("rebuilds the destination order around beforeId when a position is requested", async () => {
    m.page.findMany.mockResolvedValue([{ id: "a" }, { id: "page" }, { id: "b" }, { id: "c" }]);

    await move({ parentPageId: null, beforeId: "c" });

    expect(m.page.aggregate).not.toHaveBeenCalled();
    expect(updateCalls().filter((c: any) => c.data.position !== undefined)).toEqual([
      { where: { id: "a" }, data: { position: 0 } },
      { where: { id: "b" }, data: { position: 1 } },
      { where: { id: "page" }, data: { position: 2 } },
      { where: { id: "c" }, data: { position: 3 } },
    ]);
  });

  it("falls back to the end when beforeId is not a sibling", async () => {
    m.page.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);

    await move({ parentPageId: null, beforeId: "elsewhere" });

    const positions = updateCalls()
      .filter((c: any) => c.data.position !== undefined)
      .map((c: any) => c.where.id);
    expect(positions).toEqual(["a", "b", "page"]);
  });
});

describe("movePage: destination ancestry from one chain", () => {
  it("reads the destination's ancestors with a single query", async () => {
    await move({ parentPageId: "dest" });
    expect(loadAncestorChain).toHaveBeenCalledTimes(1);
    expect(loadAncestorChain).toHaveBeenCalledWith("dest");
    expect(m.page.findUnique).toHaveBeenCalledTimes(1);
  });

  it("does not look up ancestors when moving to the top level", async () => {
    await move({ parentPageId: null });
    expect(loadAncestorChain).not.toHaveBeenCalled();
  });

  it("refuses a folder that would settle past the depth limit", async () => {
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["x"], height: 2 });
    m.page.findUnique.mockResolvedValue(sourcePage({ kind: "Folder" }));
    // dest at depth 4: the folder lands at 5 and its height-2 subtree reaches 7.
    vi.mocked(loadAncestorChain).mockResolvedValue(chainDown(5));

    expect(await move({ parentPageId: "dest" })).toEqual({
      ok: false,
      status: 400,
      error: "Folder is too deeply nested",
    });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("allows the same folder one level higher", async () => {
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["x"], height: 2 });
    m.page.findUnique.mockResolvedValue(sourcePage({ kind: "Folder" }));
    vi.mocked(loadAncestorChain).mockResolvedValue(chainDown(4));

    expect((await move({ parentPageId: "dest" })).ok).toBe(true);
  });

  it("refuses a broken chain as too deeply nested", async () => {
    vi.mocked(loadAncestorChain).mockResolvedValue([ancestor("dest", "gone")]);
    expect(await move({ parentPageId: "dest" })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses to move a page into its own descendant", async () => {
    vi.mocked(loadAncestorChain).mockResolvedValue([
      ancestor("dest", "mid"),
      ancestor("mid", "page"),
      ancestor("page", null),
    ]);
    expect(await move({ parentPageId: "dest" })).toEqual({
      ok: false,
      status: 400,
      error: "A document can't be moved into its own descendant",
    });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to move a page into itself", async () => {
    expect(await move({ parentPageId: "page" })).toEqual({
      ok: false,
      status: 400,
      error: "A document can't be moved into itself",
    });
  });

  it("restricts general access when any ancestor carries a scope", async () => {
    vi.mocked(loadAncestorChain).mockResolvedValue([
      ancestor("dest", "mid"),
      ancestor("mid", "top", { scopeKind: "Group" }),
      ancestor("top", null),
    ]);
    await move({ parentPageId: "dest" });
    expect(updateCalls()[0].data).toMatchObject({ linkAccess: "Restricted", linkPermission: "View" });
  });

  it("leaves general access alone for an unscoped same-workspace move", async () => {
    await move({ parentPageId: "dest" });
    expect(updateCalls()[0].data).not.toHaveProperty("linkAccess");
  });
});

describe("movePage: refusals keep their precedence", () => {
  it("answers 403 for the source before anything the destination would say", async () => {
    vi.mocked(canManageSharing).mockResolvedValue(false);
    vi.mocked(loadAncestorChain).mockResolvedValue([]);
    expect(await move({ parentPageId: "dest" })).toEqual({
      ok: false,
      status: 403,
      error: "You can't move this document",
    });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("answers 403 for a destination workspace before a missing folder", async () => {
    m.page.findUnique.mockResolvedValue(sourcePage({ workspaceType: "Project", workspaceId: "proj" }));
    vi.mocked(isLabMember).mockResolvedValue(false);
    vi.mocked(loadAncestorChain).mockResolvedValue([]);
    expect(await move({ workspaceType: "Lab", parentPageId: "dest" })).toEqual({
      ok: false,
      status: 403,
      error: "You can't move documents into that destination",
    });
  });

  it("answers 404 for a missing destination folder once the checks before it pass", async () => {
    vi.mocked(loadAncestorChain).mockResolvedValue([]);
    expect(await move({ parentPageId: "dest" })).toEqual({ ok: false, status: 404, error: "Folder not found" });
  });

  it("answers 404 for a destination folder in another workspace", async () => {
    vi.mocked(loadAncestorChain).mockResolvedValue(destChain({ workspaceType: "Project", workspaceId: "p" }));
    expect(await move({ parentPageId: "dest" })).toMatchObject({ status: 404 });
  });

  it("answers 404 for an archived destination folder", async () => {
    vi.mocked(loadAncestorChain).mockResolvedValue(destChain({ archivedAt: new Date() }));
    expect(await move({ parentPageId: "dest" })).toMatchObject({ status: 404 });
  });

  it("answers 400 for a destination that is not a folder", async () => {
    vi.mocked(loadAncestorChain).mockResolvedValue(destChain({ kind: "FreeForm" }));
    expect(await move({ parentPageId: "dest" })).toMatchObject({ status: 400 });
  });

  it("answers 403 when the viewer can't edit the destination folder", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false, canComment: true } as never);
    expect(await move({ parentPageId: "dest" })).toEqual({
      ok: false,
      status: 403,
      error: "You can't put things in that folder",
    });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("checks the destination folder's access once, by id", async () => {
    await move({ parentPageId: "dest" });
    expect(getPageAccess).toHaveBeenCalledTimes(1);
    expect(getPageAccess).toHaveBeenCalledWith("u1", "dest", undefined);
  });

  it("refuses a Lab folder holding agreements or rubrics a trip out of Lab", async () => {
    m.page.findUnique.mockResolvedValue(sourcePage({ kind: "Folder" }));
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["child"], height: 1 });
    m.signingDocument.count.mockResolvedValue(1);
    vi.mocked(isCore).mockResolvedValue(true);

    const result = await move({ workspaceType: "Project", workspaceId: "proj", parentPageId: null });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(m.signingDocument.count).toHaveBeenCalledWith({
      where: { folderPageId: { in: ["page", "child"] }, archivedAt: null },
    });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("writes nothing when the source is a root folder", async () => {
    m.page.findUnique.mockResolvedValue(sourcePage({ folderType: "Root" }));
    expect(await move({ parentPageId: null })).toMatchObject({ ok: false, status: 400 });
    expect(m.$transaction).not.toHaveBeenCalled();
  });
});

describe("movePage: notebooks", () => {
  it("adds a document to a notebook parent without moving it", async () => {
    vi.mocked(loadAncestorChain).mockResolvedValue([ancestor("dest", null, { kind: "Notebook" })]);

    const result = await move({ parentPageId: "dest" });

    expect(result).toEqual({ ok: true, clearedReceivers: [] });
    expect(addToNotebook).toHaveBeenCalledWith("page", "dest", "u1");
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("only takes documents into a notebook", async () => {
    m.page.findUnique.mockResolvedValue(sourcePage({ kind: "Folder" }));
    vi.mocked(loadAncestorChain).mockResolvedValue([ancestor("dest", null, { kind: "Notebook" })]);
    expect(await move({ parentPageId: "dest" })).toMatchObject({ ok: false, status: 400 });
    expect(addToNotebook).not.toHaveBeenCalled();
  });
});

describe("movePage: leaving a notebook", () => {
  const tab = () =>
    sourcePage({ parent: { id: "nb1", kind: "Notebook", archivedAt: null } });

  it("needs manage authority on the notebook to move a tab out", async () => {
    m.page.findUnique.mockResolvedValue(tab());
    await move({ parentPageId: null });
    expect(loadManageableNotebook).toHaveBeenCalledWith("nb1", "u1", undefined);
  });

  it("refuses with the notebook's error when the actor cannot manage it", async () => {
    m.page.findUnique.mockResolvedValue(tab());
    const refusal = Response.json({ error: "no" }, { status: 403 });
    vi.mocked(loadManageableNotebook).mockRejectedValue(new Error("403"));
    vi.mocked(notebookErrorResponse).mockReturnValue(refusal);
    expect(await move({ parentPageId: null })).toEqual({ ok: false, response: refusal });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("does not ask when the tab stays in its notebook or the notebook is trashed", async () => {
    m.page.findUnique.mockResolvedValue(tab());
    vi.mocked(loadAncestorChain).mockResolvedValue([ancestor("nb1", null, { kind: "Notebook" })]);
    await move({ parentPageId: "nb1" });
    m.page.findUnique.mockResolvedValue(
      sourcePage({ parent: { id: "nb1", kind: "Notebook", archivedAt: new Date() } }),
    );
    await move({ parentPageId: null });
    expect(loadManageableNotebook).not.toHaveBeenCalled();
  });

  it("does not ask for a page that is not in a notebook", async () => {
    await move({ parentPageId: null });
    expect(loadManageableNotebook).not.toHaveBeenCalled();
  });
});

describe("movePage: cross-workspace move", () => {
  const toProject = { workspaceType: "Project" as const, workspaceId: "proj", parentPageId: null };

  beforeEach(() => {
    m.page.findUnique.mockResolvedValue(sourcePage({ kind: "Folder" }));
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["child", "grandchild"], height: 2 });
    m.projectFile.findMany.mockResolvedValue([{ id: "file1" }]);
  });

  it("rewrites the whole subtree and its files in one transaction, then audits", async () => {
    const result = await move(toProject);

    expect(result.ok).toBe(true);
    expect(m.$transaction).toHaveBeenCalledTimes(1);
    const ops = m.$transaction.mock.calls[0][0].map((o: any) => o.op);
    expect(ops).toEqual(["page.update", "page.updateMany", "projectFile.updateMany"]);
    expect(m.page.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ["child", "grandchild"] } });
    expect(m.projectFile.findMany).toHaveBeenCalledWith({
      where: { folderPageId: { in: ["page", "child", "grandchild"] }, archivedAt: null },
      select: { id: true },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "page.move-workspace",
        metadata: expect.objectContaining({ descendantCount: 2, fileCount: 1 }),
      }),
    );
  });

  it("asks which receivers it cleared for the folders it moved", async () => {
    vi.mocked(clearTypeIfLeavingRoot).mockResolvedValue(["page"]);
    expect(await move(toProject)).toEqual({ ok: true, clearedReceivers: ["page"] });
    expect(clearTypeIfLeavingRoot).toHaveBeenCalledWith(["page", "child", "grandchild"]);
  });

  it("does not audit a same-workspace move", async () => {
    await move({ parentPageId: null });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("includes extraOps in the same transaction", async () => {
    const extra = { op: "extra" };
    await move(toProject, { extraOps: [extra] });
    expect(m.$transaction.mock.calls[0][0]).toContain(extra);
  });

  it("refuses when the actor can't edit in the destination workspace", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect(await move(toProject)).toMatchObject({ ok: false, status: 403 });
    expect(m.$transaction).not.toHaveBeenCalled();
  });
});
