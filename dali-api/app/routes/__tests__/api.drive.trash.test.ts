import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/forms/lib/form-page.server", () => ({ setFormArchived: vi.fn(), deleteForm: vi.fn() }));
vi.mock("~/forms/lib/form-usages.server", () => ({ formDeletionBlockers: vi.fn() }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/roles", () => ({
  canViewForms: vi.fn(),
}));
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
  getPageAccessBulk: vi.fn(),
}));
vi.mock("~/lib/fileAccess.server", () => ({
  canEditFile: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { canViewForms } from "~/lib/roles";
import { getPageAccess, getPageAccessBulk } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import { loader, action } from "~/routes/api.drive.trash";
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
  vi.mocked(canViewForms).mockResolvedValue(false);
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
    expect(mockPrisma.page.findMany.mock.calls[0][0].where.kind.in).toContain("Whiteboard");
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
    expect(mockPrisma.page.findMany.mock.calls[0][0].where.kind.in).toContain("Notebook");
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

describe("GET /api/drive/trash (forms)", () => {
  const formPage = { id: "form-1", title: "Intake", archivedAt: ARCHIVED_AT, kind: "Form", parentPageId: "folder-1" };
  const list = async () => {
    const res = (await loader({ request: new Request("http://os.test/api/drive/trash") } as never)) as Response;
    return ((await res.json()) as { items: { id: string; type: string; title: string }[] }).items;
  };

  it("lists an archived Form page as a form when the viewer has the forms gate", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);
    mockPrisma.page.findMany.mockResolvedValue([formPage]);

    expect(await list()).toEqual([
      { id: "form-1", type: "form", title: "Intake", parentFolderId: null, archivedAt: ARCHIVED_AT.toISOString() },
    ]);
    expect(mockPrisma.page.findMany.mock.calls[0][0].where.kind.in).toContain("Form");
  });

  it("drops Form pages for a viewer without the forms gate, whatever page access says", async () => {
    mockPrisma.page.findMany.mockResolvedValue([formPage]);
    bulkAccess(FULL);

    expect(await list()).toEqual([]);
  });

  it("does not run a Form page through page access", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);
    mockPrisma.page.findMany.mockResolvedValue([formPage]);

    await list();

    expect(vi.mocked(getPageAccessBulk).mock.calls[0]?.[1]).toEqual([]);
  });
});

describe("POST /api/drive/trash (forms)", () => {
  const post = (fields: Record<string, string>) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return action({ request: new Request("http://os.test/api/drive/trash", { method: "POST", body }) } as never) as Promise<Response>;
  };
  const formModel = () => prisma.form as unknown as { findUnique: ReturnType<typeof vi.fn> };

  it("archives a form through the helper", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);
    formModel().findUnique.mockResolvedValue({ id: "form-1", archivedAt: null });

    expect((await post({ intent: "archive-form", id: "form-1" })).status).toBe(200);
    expect(setFormArchived).toHaveBeenCalledWith("form-1", expect.any(Date));
  });

  it("restores a form through the helper", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);

    expect((await post({ intent: "restore", type: "form", id: "form-1" })).status).toBe(200);
    expect(setFormArchived).toHaveBeenCalledWith("form-1", null);
  });

  it("purges a form through the helper", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);
    vi.mocked(formDeletionBlockers).mockResolvedValue([]);

    expect((await post({ intent: "purge", type: "form", id: "form-1" })).status).toBe(200);
    expect(deleteForm).toHaveBeenCalledWith("form-1");
  });

  it("refuses to purge a form that is still in use", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);
    vi.mocked(formDeletionBlockers).mockResolvedValue(["the 26F application"]);

    expect((await post({ intent: "purge", type: "form", id: "form-1" })).status).toBe(409);
    expect(deleteForm).not.toHaveBeenCalled();
  });

  it("refuses every form action without the forms gate", async () => {
    const attempts: Record<string, string>[] = [
      { intent: "archive-form", id: "form-1" },
      { intent: "restore", type: "form", id: "form-1" },
      { intent: "purge", type: "form", id: "form-1" },
    ];
    for (const fields of attempts) {
      expect((await post(fields)).status).toBe(403);
    }
    expect(setFormArchived).not.toHaveBeenCalled();
    expect(deleteForm).not.toHaveBeenCalled();
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
