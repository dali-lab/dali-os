import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/forms/lib/form-page.server", () => ({ setFormArchived: vi.fn(), deleteForm: vi.fn() }));
vi.mock("~/forms/lib/form-usages.server", () => ({ formDeletionBlockers: vi.fn() }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/forms/lib/form-access.server", () => ({ canManageFormPlacement: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
  getPageAccessBulk: vi.fn(),
}));
vi.mock("~/lib/fileAccess.server", () => ({
  canEditFile: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { canManageFormPlacement } from "~/forms/lib/form-access.server";
import { getPageAccess, getPageAccessBulk } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import { logAuditEvent } from "~/lib/audit";
import {
  loader,
  action,
  parseTrashCursor,
  TRASH_BATCH_SIZE,
  TRASH_MAX_BATCHES,
  TRASH_PAGE_SIZE,
} from "~/routes/api.drive.trash";
import { deleteForm, setFormArchived } from "~/forms/lib/form-page.server";
import { formDeletionBlockers } from "~/forms/lib/form-usages.server";

const mockPrisma = prisma as unknown as {
  page: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  projectFile: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

/** Resolve every page in the batch to the same access result. */
function bulkAccess(result: { canView: boolean; canEdit: boolean; canComment: boolean }) {
  vi.mocked(getPageAccessBulk).mockImplementation(async (_u, pages) =>
    new Map(pages.map((p) => [p.id, result])),
  );
}

// Every row this route touches is archived by definition, so each access check
// has to look past the archive — otherwise the trash lists no document and
// restores none of them.
const ARCHIVED_AT = new Date("2026-09-30T07:20:00Z");
const FULL = { canView: true, canEdit: true, canComment: true };
const DENIED = { canView: false, canEdit: false, canComment: false };

function restoreRequest(type: string, id: string) {
  const body = new FormData();
  body.set("intent", "restore");
  body.set("type", type);
  body.set("id", id);
  return new Request("http://os.test/api/drive/trash", { method: "POST", body });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "user-1" },
  } as unknown as Awaited<ReturnType<typeof requireAuth>>);
  vi.mocked(canManageFormPlacement).mockResolvedValue(false);
  vi.mocked(canEditFile).mockResolvedValue(false);
  mockPrisma.page.findMany.mockResolvedValue([]);
  mockPrisma.page.update.mockResolvedValue({});
  mockPrisma.page.delete.mockResolvedValue({});
  mockPrisma.page.count.mockResolvedValue(0);
  mockPrisma.projectFile.findMany.mockResolvedValue([]);
  mockPrisma.projectFile.count.mockResolvedValue(0);
  bulkAccess(DENIED);
});

describe("GET /api/drive/trash", () => {
  it("lists an archived doc the viewer can still access", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "page-1", title: "Team meeting note", archivedAt: ARCHIVED_AT, kind: "FreeForm" },
    ]);
    bulkAccess(FULL);

    const res = (await loader({
      request: new Request("http://os.test/api/drive/trash"),
    } as never)) as Response;
    const body = (await res.json()) as { items: { id: string; type: string }[] };

    expect(body.items).toEqual([
      { id: "page-1", type: "doc", title: "Team meeting note", archivedAt: ARCHIVED_AT.toISOString() },
    ]);
    expect(vi.mocked(getPageAccessBulk).mock.calls[0]?.[3]).toEqual({ includeArchived: true });
  });

  // The Drive archives a whiteboard through the same path as a doc, so leaving
  // Whiteboard out of this query meant a trashed one could never be restored.
  it("includes archived whiteboards", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "wb-1", title: "Sprint canvas", archivedAt: ARCHIVED_AT, kind: "Whiteboard" },
    ]);
    bulkAccess(FULL);

    const res = (await loader({
      request: new Request("http://os.test/api/drive/trash"),
    } as never)) as Response;
    const body = (await res.json()) as { items: { id: string }[] };

    expect(body.items.map((i) => i.id)).toEqual(["wb-1"]);
    expect(mockPrisma.page.findMany.mock.calls[0][0].where.AND[0].kind.in).toContain("Whiteboard");
  });

  it("includes archived notebooks", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "nb-1", title: "Weekly sync", archivedAt: ARCHIVED_AT, kind: "Notebook" },
    ]);
    bulkAccess(FULL);

    const res = (await loader({
      request: new Request("http://os.test/api/drive/trash"),
    } as never)) as Response;
    const body = (await res.json()) as { items: { id: string }[] };

    expect(body.items.map((i) => i.id)).toEqual(["nb-1"]);
    expect(mockPrisma.page.findMany.mock.calls[0][0].where.AND[0].kind.in).toContain("Notebook");
  });

  it("bounds the scan rather than reading every archived row", async () => {
    await loader({ request: new Request("http://os.test/api/drive/trash") } as never);
    expect(mockPrisma.page.findMany.mock.calls[0][0].take).toBeGreaterThan(0);
    expect(mockPrisma.projectFile.findMany.mock.calls[0][0].take).toBeGreaterThan(0);
  });

  it("leaves out an archived doc the viewer can't access", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "page-1", title: "Team meeting note", archivedAt: ARCHIVED_AT, kind: "FreeForm" },
    ]);
    bulkAccess(DENIED);

    const res = (await loader({
      request: new Request("http://os.test/api/drive/trash"),
    } as never)) as Response;
    const body = (await res.json()) as { items: unknown[] };

    expect(body.items).toEqual([]);
  });
});

function pageRows(count: number, startIndex = 0) {
  return Array.from({ length: count }, (_, i) => {
    const n = startIndex + i;
    return {
      id: `page-${String(n).padStart(5, "0")}`,
      title: `Note ${n}`,
      archivedAt: new Date(ARCHIVED_AT.getTime() - n * 1000),
      kind: "FreeForm",
    };
  });
}

async function list(query = "") {
  const res = (await loader({
    request: new Request(`http://os.test/api/drive/trash${query}`),
  } as never)) as Response;
  return (await res.json()) as { items: { id: string; type: string }[]; nextCursor: string | null };
}

describe("GET /api/drive/trash (paging)", () => {
  it("returns a null cursor when every row was seen", async () => {
    mockPrisma.page.findMany.mockResolvedValue(pageRows(3));
    bulkAccess(FULL);
    expect((await list()).nextCursor).toBeNull();
  });

  it("returns one page of visible rows and a cursor at the last row returned", async () => {
    mockPrisma.page.findMany.mockResolvedValue(pageRows(TRASH_BATCH_SIZE));
    bulkAccess(FULL);
    const body = await list();
    expect(body.items).toHaveLength(TRASH_PAGE_SIZE);
    expect(body.nextCursor).toBe(
      `${pageRows(TRASH_PAGE_SIZE).at(-1)!.archivedAt.toISOString()}|page-00049~done`,
    );
  });

  it("keeps scanning batches until enough visible rows are found", async () => {
    mockPrisma.page.findMany
      .mockResolvedValueOnce(pageRows(TRASH_BATCH_SIZE, 0))
      .mockResolvedValueOnce(pageRows(2, TRASH_BATCH_SIZE));
    vi.mocked(getPageAccessBulk).mockImplementation(async (_u, pages) =>
      new Map(pages.map((p) => [p.id, { ...FULL, canView: p.id >= `page-${String(TRASH_BATCH_SIZE).padStart(5, "0")}` }])),
    );
    const body = await list();
    expect(body.items.map((i) => i.id)).toEqual(["page-00200", "page-00201"]);
    expect(body.nextCursor).toBeNull();
    const secondWhere = mockPrisma.page.findMany.mock.calls[1][0].where.AND[1];
    expect(secondWhere.OR[0].archivedAt.lt).toEqual(pageRows(TRASH_BATCH_SIZE).at(-1)!.archivedAt);
  });

  it("hands back a cursor from the last row scanned when the scan cap is hit with nothing visible", async () => {
    mockPrisma.page.findMany.mockImplementation(async () => pageRows(TRASH_BATCH_SIZE));
    bulkAccess(DENIED);
    const body = await list();
    expect(body.items).toEqual([]);
    expect(mockPrisma.page.findMany).toHaveBeenCalledTimes(TRASH_MAX_BATCHES);
    expect(body.nextCursor).toBe(
      `${pageRows(TRASH_BATCH_SIZE).at(-1)!.archivedAt.toISOString()}|page-00199~done`,
    );
  });

  it("resumes each table from its own position in the cursor", async () => {
    const at = ARCHIVED_AT.toISOString();
    await list(`?cursor=${encodeURIComponent(`${at}|page-1~done`)}`);
    expect(mockPrisma.page.findMany.mock.calls[0][0].where.AND[1].OR[1]).toEqual({
      archivedAt: ARCHIVED_AT,
      id: { lt: "page-1" },
    });
    expect(mockPrisma.projectFile.findMany).not.toHaveBeenCalled();
  });

  it("treats a malformed cursor as the first page", () => {
    expect(parseTrashCursor("garbage")).toEqual({ pages: "garbage", files: null });
    expect(parseTrashCursor(null)).toEqual({ pages: null, files: null });
    expect(parseTrashCursor("start~done")).toEqual({ pages: null, files: "done" });
  });

  it("never returns a row the viewer cannot see, even when paging", async () => {
    mockPrisma.page.findMany.mockResolvedValue(pageRows(4));
    vi.mocked(getPageAccessBulk).mockImplementation(async (_u, pages) =>
      new Map(pages.map((p) => [p.id, { ...FULL, canView: p.id !== "page-00001" }])),
    );
    expect((await list()).items.map((i) => i.id)).toEqual(["page-00000", "page-00002", "page-00003"]);
  });

  it("pages files with the same keyset and edit check", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      { id: "file-1", title: "Plan.pdf", archivedAt: ARCHIVED_AT, projectId: null, workspaceType: null, workspaceId: null, folderPageId: null },
    ]);
    vi.mocked(canEditFile).mockResolvedValue(true);
    const body = await list();
    expect(body.items.map((i) => i.id)).toEqual(["file-1"]);
    expect(mockPrisma.projectFile.findMany.mock.calls[0][0].orderBy).toEqual([
      { archivedAt: "desc" },
      { id: "desc" },
    ]);
  });
});

describe("POST /api/drive/trash (restore)", () => {
  it("restores a doc for someone with edit access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(FULL);

    const res = (await action({ request: restoreRequest("doc", "page-1") } as never)) as Response;

    expect(res.status).toBe(200);
    expect(mockPrisma.page.update).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { archivedAt: null },
    });
    expect(vi.mocked(getPageAccess).mock.calls[0]?.[3]).toEqual({ includeArchived: true });
  });

  it("refuses to restore a doc the viewer can only view", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ ...FULL, canEdit: false });

    const res = (await action({ request: restoreRequest("doc", "page-1") } as never)) as Response;

    expect(res.status).toBe(403);
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/drive/trash (restore a notebook)", () => {
  const pageMock = prisma.page as unknown as {
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.mocked(getPageAccess).mockResolvedValue(FULL);
  });

  it("brings back the tabs that were trashed with it, by the same instant", async () => {
    pageMock.findUnique.mockResolvedValue({ kind: "Notebook", archivedAt: ARCHIVED_AT });

    const res = (await action({ request: restoreRequest("doc", "nb-1") } as never)) as Response;

    expect(res.status).toBe(200);
    expect(mockPrisma.page.update).toHaveBeenCalledWith({ where: { id: "nb-1" }, data: { archivedAt: null } });
    expect(pageMock.updateMany).toHaveBeenCalledWith({
      where: { parentPageId: "nb-1", archivedAt: ARCHIVED_AT },
      data: { archivedAt: null },
    });
  });

  it("restores only the page itself for anything that is not a notebook", async () => {
    pageMock.findUnique.mockResolvedValue({ kind: "FreeForm", archivedAt: ARCHIVED_AT });

    await action({ request: restoreRequest("doc", "page-1") } as never);

    expect(pageMock.updateMany).not.toHaveBeenCalled();
  });
});

function purgeRequest(type: string, id: string) {
  const body = new FormData();
  body.set("intent", "purge");
  body.set("type", type);
  body.set("id", id);
  return new Request("http://os.test/api/drive/trash", { method: "POST", body });
}

// Purge checked access WITHOUT includeArchived. Everything in Trash is
// archived by definition, so getPageAccess denied every caller and purging a
// doc or folder could never succeed — it always came back "Couldn't delete".
describe("POST /api/drive/trash (purge)", () => {
  it("purges a doc for someone with edit access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(FULL);

    const res = (await action({ request: purgeRequest("doc", "page-1") } as never)) as Response;

    expect(res.status).toBe(200);
    expect(mockPrisma.page.delete).toHaveBeenCalledWith({ where: { id: "page-1" } });
  });

  it("looks past the archive when checking access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(FULL);
    await action({ request: purgeRequest("doc", "page-1") } as never);
    expect(vi.mocked(getPageAccess).mock.calls[0]?.[3]).toEqual({ includeArchived: true });
  });

  it("still refuses someone who can only view", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ ...FULL, canEdit: false });

    const res = (await action({ request: purgeRequest("doc", "page-1") } as never)) as Response;

    expect(res.status).toBe(403);
    expect(mockPrisma.page.delete).not.toHaveBeenCalled();
  });

  // A folder's children carry an onDelete: SetNull parent link, so a hard
  // delete would silently re-home everything inside it to the drive root.
  it("refuses a folder that still holds anything", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(FULL);
    mockPrisma.projectFile.count.mockResolvedValue(3);

    const res = (await action({ request: purgeRequest("folder", "f1") } as never)) as Response;

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/still holds 3 items/);
    expect(mockPrisma.page.delete).not.toHaveBeenCalled();
  });

  it("refuses to purge a Drive root", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(FULL);
    (prisma.page.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ folderType: "Root" });

    const res = (await action({ request: purgeRequest("folder", "root1") } as never)) as Response;

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This is a Drive root and can't be deleted");
    expect(mockPrisma.page.delete).not.toHaveBeenCalled();
  });

  it("purges an empty folder", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(FULL);

    const res = (await action({ request: purgeRequest("folder", "f1") } as never)) as Response;

    expect(res.status).toBe(200);
    expect(mockPrisma.page.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
  });
});

describe("POST /api/drive/trash (audit)", () => {
  const findPage = prisma.page.findUnique as unknown as ReturnType<typeof vi.fn>;
  const findFile = (prisma.projectFile as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique;
  const purge = (type: string, id: string) => {
    const body = new FormData();
    body.set("intent", "purge");
    body.set("type", type);
    body.set("id", id);
    return action({ request: new Request("http://os.test/api/drive/trash", { method: "POST", body }) } as never);
  };

  it("logs a doc purge with its title and kind", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(FULL);
    findPage.mockResolvedValue({ folderType: null, title: "Budget" });

    await purge("doc", "page-1");

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "drive.trash.purge",
        userId: "user-1",
        targetId: "page-1",
        metadata: { type: "doc", title: "Budget" },
      }),
    );
  });

  it("logs a file purge and a file restore with the file title", async () => {
    vi.mocked(canEditFile).mockResolvedValue(true);
    findFile.mockResolvedValue({ projectId: "p1", title: "plan.pdf" });
    (prisma.projectFile as unknown as { delete: ReturnType<typeof vi.fn> }).delete = vi.fn();
    (prisma.projectFile as unknown as { update: ReturnType<typeof vi.fn> }).update = vi.fn();

    await purge("file", "file-1");
    await action({ request: restoreRequest("file", "file-1") } as never);

    expect(vi.mocked(logAuditEvent).mock.calls.map(([e]) => [e.action, e.targetId, e.metadata])).toEqual([
      ["drive.trash.purge", "file-1", { type: "file", title: "plan.pdf" }],
      ["drive.trash.restore", "file-1", { type: "file", title: "plan.pdf" }],
    ]);
  });

  it("logs a doc restore", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(FULL);
    findPage.mockResolvedValue({ kind: "FreeForm", archivedAt: ARCHIVED_AT, title: "Notes" });

    await action({ request: restoreRequest("doc", "page-1") } as never);

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "drive.trash.restore",
        targetId: "page-1",
        metadata: { type: "doc", title: "Notes" },
      }),
    );
  });

  it("logs a form purge with the title read before the delete", async () => {
    vi.mocked(canManageFormPlacement).mockResolvedValue(true);
    vi.mocked(formDeletionBlockers).mockResolvedValue([]);
    findPage.mockResolvedValue({ title: "Intake" });

    await purge("form", "form-1");

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "drive.trash.purge",
        targetId: "form-1",
        metadata: { type: "form", title: "Intake" },
      }),
    );
  });

  it("logs nothing when the purge is refused", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ ...FULL, canEdit: false });
    await purge("doc", "page-1");

    mockPrisma.projectFile.count.mockResolvedValue(2);
    vi.mocked(getPageAccess).mockResolvedValue(FULL);
    await purge("folder", "f1");

    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
