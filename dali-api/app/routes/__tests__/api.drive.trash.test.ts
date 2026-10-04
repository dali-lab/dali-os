import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
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

const mockPrisma = prisma as unknown as {
  page: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  projectFile: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  form: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
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
  mockPrisma.form.findMany.mockResolvedValue([]);
  mockPrisma.form.count.mockResolvedValue(0);
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

  it("purges an empty folder", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(FULL);

    const res = (await action({ request: purgeRequest("folder", "f1") } as never)) as Response;

    expect(res.status).toBe(200);
    expect(mockPrisma.page.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
  });
});
