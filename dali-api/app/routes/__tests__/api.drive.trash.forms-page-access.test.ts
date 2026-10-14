import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/forms/lib/form-page.server", () => ({ setFormArchived: vi.fn(), deleteForm: vi.fn() }));
vi.mock("~/forms/lib/form-usages.server", () => ({ formDeletionBlockers: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/roles", () => ({ canViewForms: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
  getPageAccessBulk: vi.fn(),
}));
vi.mock("~/lib/fileAccess.server", () => ({ canEditFile: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({
  formsUsePageAccess: vi.fn(),
  canManageFormPlacement: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { canViewForms } from "~/lib/roles";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { canManageFormPlacement, formsUsePageAccess } from "~/forms/lib/form-access.server";
import { deleteForm, setFormArchived } from "~/forms/lib/form-page.server";
import { formDeletionBlockers } from "~/forms/lib/form-usages.server";
import { loader, action } from "~/routes/api.drive.trash";

const mockPrisma = prisma as unknown as {
  page: { findMany: ReturnType<typeof vi.fn> };
  projectFile: { findMany: ReturnType<typeof vi.fn> };
  form: { findUnique: ReturnType<typeof vi.fn> };
};
const ARCHIVED_AT = new Date("2026-09-30T07:20:00Z");
const formPage = { id: "form-1", title: "Intake", archivedAt: ARCHIVED_AT, kind: "Form", parentPageId: "folder-1" };
const docPage = { id: "doc-1", title: "Note", archivedAt: ARCHIVED_AT, kind: "FreeForm", parentPageId: null };

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({ request: new Request("http://os.test/api/drive/trash", { method: "POST", body }) } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "user-1" } } as never);
  mockPrisma.page.findMany.mockResolvedValue([]);
  mockPrisma.projectFile.findMany.mockResolvedValue([]);
  vi.mocked(canViewForms).mockResolvedValue(true);
  vi.mocked(formsUsePageAccess).mockResolvedValue(true);
});

describe("GET /api/drive/trash, forms-page-access on", () => {
  const list = async () =>
    ((await (loader({ request: new Request("http://os.test/api/drive/trash") } as never) as Promise<Response>)).json()) as Promise<{
      items: { id: string; type: string; parentFolderId: string | null }[];
    }>;

  it("runs Form pages through the same batched page access as docs", async () => {
    mockPrisma.page.findMany.mockResolvedValue([formPage, docPage]);
    vi.mocked(getPageAccessBulk).mockImplementation(async (_u, pages) =>
      new Map(pages.map((p) => [p.id, { canView: true, canEdit: false, canComment: false }])),
    );
    const body = await list();
    expect(body.items.map((i) => [i.id, i.type, i.parentFolderId]).sort()).toEqual([
      ["doc-1", "doc", null],
      ["form-1", "form", "folder-1"],
    ]);
    const batch = vi.mocked(getPageAccessBulk).mock.calls[0];
    expect(batch[1].map((p) => p.id).sort()).toEqual(["doc-1", "form-1"]);
    expect(batch[3]).toEqual({ includeArchived: true });
  });

  it("hides a form the viewer cannot view, even with canViewForms", async () => {
    mockPrisma.page.findMany.mockResolvedValue([formPage, docPage]);
    vi.mocked(getPageAccessBulk).mockImplementation(async (_u, pages) =>
      new Map(pages.map((p) => [p.id, { canView: p.id !== "form-1", canEdit: false, canComment: false }])),
    );
    expect((await list()).items.map((i) => i.id)).toEqual(["doc-1"]);
  });

  it("does not consult canViewForms for the listing", async () => {
    await list();
    expect(canViewForms).not.toHaveBeenCalled();
  });
});

describe("POST /api/drive/trash (forms), forms-page-access on", () => {
  it("asks canManageFormPlacement for the form id on archive, restore and purge", async () => {
    vi.mocked(canManageFormPlacement).mockResolvedValue(true);
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", archivedAt: null });
    vi.mocked(formDeletionBlockers).mockResolvedValue([]);
    expect((await post({ intent: "archive-form", id: "form-1" })).status).toBe(200);
    expect((await post({ intent: "restore", type: "form", id: "form-1" })).status).toBe(200);
    expect((await post({ intent: "purge", type: "form", id: "form-1" })).status).toBe(200);
    expect(canManageFormPlacement).toHaveBeenCalledTimes(3);
    expect(canManageFormPlacement).toHaveBeenCalledWith("user-1", "form-1", expect.any(Request));
    expect(setFormArchived).toHaveBeenCalledTimes(2);
    expect(deleteForm).toHaveBeenCalledWith("form-1");
  });

  it("refuses all three when the page is not editable", async () => {
    vi.mocked(canManageFormPlacement).mockResolvedValue(false);
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
