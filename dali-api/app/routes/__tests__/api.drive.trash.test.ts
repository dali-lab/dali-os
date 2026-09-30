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
}));
vi.mock("~/lib/fileAccess.server", () => ({
  canEditFile: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { canViewForms } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import { loader, action } from "~/routes/api.drive.trash";

const mockPrisma = prisma as unknown as {
  page: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  projectFile: { findMany: ReturnType<typeof vi.fn> };
  form: { findMany: ReturnType<typeof vi.fn> };
};

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
  mockPrisma.projectFile.findMany.mockResolvedValue([]);
  mockPrisma.form.findMany.mockResolvedValue([]);
});

describe("GET /api/drive/trash", () => {
  it("lists an archived doc the viewer can still access", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "page-1", title: "Team meeting note", archivedAt: ARCHIVED_AT, kind: "FreeForm" },
    ]);
    vi.mocked(getPageAccess).mockResolvedValue(FULL);

    const res = (await loader({
      request: new Request("http://os.test/api/drive/trash"),
    } as never)) as Response;
    const body = (await res.json()) as { items: { id: string; type: string }[] };

    expect(body.items).toEqual([
      { id: "page-1", type: "doc", title: "Team meeting note", archivedAt: ARCHIVED_AT.toISOString() },
    ]);
    expect(vi.mocked(getPageAccess).mock.calls[0]?.[3]).toEqual({ includeArchived: true });
  });

  it("leaves out an archived doc the viewer can't access", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "page-1", title: "Team meeting note", archivedAt: ARCHIVED_AT, kind: "FreeForm" },
    ]);
    vi.mocked(getPageAccess).mockResolvedValue(DENIED);

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
