import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    projectFile: { findUnique: vi.fn(), update: vi.fn() },
    form: { findUnique: vi.fn(), update: vi.fn() },
    page: { findUnique: vi.fn() },
  },
}));
vi.mock("~/forms/lib/form-page.server", () => ({ moveForm: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
}));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn(), PAGE_ACCESS_SELECT: { id: true } }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/page-ancestry.server", () => ({ loadAncestorChain: vi.fn() }));

import { moveForm } from "~/forms/lib/form-page.server";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { logAuditEvent } from "~/lib/audit";
import { loadAncestorChain } from "~/lib/page-ancestry.server";
import { action } from "~/routes/api.drive.move";

const m = prisma as any;

const call = async (body: unknown) => {
  const res: Response = await action({
    request: new Request("http://localhost/api/drive/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as never);
  return { status: res.status, json: await res.json() };
};

const FILE_MOVE = { itemType: "file", itemId: "f1", destFolderPageId: "folder" };
const FORM_MOVE = { itemType: "form", itemId: "fm1", destFolderPageId: "folder" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(true);
  vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true, canComment: true } as never);
  m.projectFile.findUnique.mockResolvedValue({ projectId: "proj", archivedAt: null });
  m.form.findUnique.mockResolvedValue({ id: "fm1" });
  m.page.findUnique.mockResolvedValue({ id: "folder", kind: "Folder", archivedAt: null });
  vi.mocked(loadAncestorChain).mockResolvedValue([]);
});

describe("POST /api/drive/move root-bound items", () => {
  const root = (id: string, title: string) => ({ id, title, folderType: "Root" });

  it("refuses a file leaving a typed root", async () => {
    m.projectFile.findUnique.mockResolvedValue({ projectId: "proj", archivedAt: null, folderPageId: "src" });
    vi.mocked(loadAncestorChain).mockImplementation(async (id: string) =>
      (id === "src" ? [root("mroot", "Mentorship")] : []) as never,
    );
    const res = await call(FILE_MOVE);
    expect(res).toEqual({ status: 400, json: { error: "Mentorship items stay in Mentorship" } });
    expect(m.projectFile.update).not.toHaveBeenCalled();
  });

  it("allows a form to move within the same root", async () => {
    m.form.findUnique.mockResolvedValue({ id: "fm1", folderPageId: "src" });
    vi.mocked(loadAncestorChain).mockResolvedValue([root("core", "Core")] as never);
    const res = await call(FORM_MOVE);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/drive/move", () => {
  it("files a project file into a folder the viewer can edit, then audits", async () => {
    const res = await call(FILE_MOVE);
    expect(res).toEqual({ status: 200, json: { ok: true } });
    expect(m.projectFile.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { folderPageId: "folder" } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "drive.item.move", targetId: "f1" }),
    );
  });

  it("files a form", async () => {
    expect((await call(FORM_MOVE)).status).toBe(200);
    expect(moveForm).toHaveBeenCalledWith("fm1", "folder");
  });

  it("unplaces an item without looking at any folder", async () => {
    expect((await call({ ...FILE_MOVE, destFolderPageId: null })).status).toBe(200);
    expect(m.page.findUnique).not.toHaveBeenCalled();
    expect(m.projectFile.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { folderPageId: null } });
  });

  it("refuses agreements and rubrics before reading anything", async () => {
    expect((await call({ ...FILE_MOVE, itemType: "agreement" })).status).toBe(400);
    expect(m.projectFile.findUnique).not.toHaveBeenCalled();
    expect(m.page.findUnique).not.toHaveBeenCalled();
  });

  describe("source refusals", () => {
    it("404s a missing or archived file", async () => {
      m.projectFile.findUnique.mockResolvedValue({ projectId: "proj", archivedAt: new Date() });
      expect(await call(FILE_MOVE)).toEqual({ status: 404, json: { error: "File not found" } });
      expect(m.projectFile.update).not.toHaveBeenCalled();
    });

    it("403s a viewer who is neither Core nor on the file's project", async () => {
      vi.mocked(isProjectMember).mockResolvedValue(false);
      expect(await call(FILE_MOVE)).toEqual({ status: 403, json: { error: "You can't move this file" } });
      expect(m.projectFile.update).not.toHaveBeenCalled();
    });

    it("lets Core move a lab file with no project", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      m.projectFile.findUnique.mockResolvedValue({ projectId: null, archivedAt: null });
      expect((await call(FILE_MOVE)).status).toBe(200);
      expect(isProjectMember).not.toHaveBeenCalled();
    });

    it("403s a lab file for anyone but Core", async () => {
      m.projectFile.findUnique.mockResolvedValue({ projectId: null, archivedAt: null });
      expect((await call(FILE_MOVE)).status).toBe(403);
    });

    it("404s a missing form", async () => {
      m.form.findUnique.mockResolvedValue(null);
      expect(await call(FORM_MOVE)).toEqual({ status: 404, json: { error: "Form not found" } });
    });

  });

  describe("destination refusals", () => {
    it("404s a missing folder", async () => {
      m.page.findUnique.mockResolvedValue(null);
      expect(await call(FILE_MOVE)).toEqual({ status: 404, json: { error: "Destination folder not found" } });
    });

    it("404s an archived folder and a page that isn't a folder", async () => {
      m.page.findUnique.mockResolvedValue({ id: "folder", kind: "Folder", archivedAt: new Date() });
      expect((await call(FILE_MOVE)).status).toBe(404);
      m.page.findUnique.mockResolvedValue({ id: "folder", kind: "FreeForm", archivedAt: null });
      expect((await call(FILE_MOVE)).status).toBe(404);
    });

    it("403s a folder the viewer can't edit, and writes nothing", async () => {
      vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false, canComment: true } as never);
      expect(await call(FILE_MOVE)).toEqual({ status: 403, json: { error: "You can't place items in that folder" } });
      expect(m.projectFile.update).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe("precedence when both sides refuse", () => {
    it("reports the source first", async () => {
      vi.mocked(isProjectMember).mockResolvedValue(false);
      m.page.findUnique.mockResolvedValue(null);
      expect(await call(FILE_MOVE)).toEqual({ status: 403, json: { error: "You can't move this file" } });
    });

    it("reports a missing source before a folder the viewer can't edit", async () => {
      m.projectFile.findUnique.mockResolvedValue(null);
      vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false, canComment: true } as never);
      expect((await call(FILE_MOVE)).status).toBe(404);
    });
  });
});

describe("POST /api/drive/move (forms)", () => {
  const formEdit = (canEdit: boolean) =>
    vi.mocked(getPageAccess).mockImplementation((async (_u: string, page: { id: string }) => ({
      canView: true,
      canEdit: page.id === "fm1" ? canEdit : true,
      canComment: true,
    })) as never);

  beforeEach(() => {
    m.page.findUnique.mockImplementation(async ({ where }: { where: { id: string; kind?: string } }) =>
      where.kind === "Form"
        ? { id: "fm1" }
        : { id: where.id, kind: "Folder", archivedAt: null },
    );
  });

  it("moves a form the viewer can edit", async () => {
    formEdit(true);
    expect((await call(FORM_MOVE)).status).toBe(200);
    expect(moveForm).toHaveBeenCalledWith("fm1", "folder");
  });

  it("refuses a form the viewer cannot edit", async () => {
    formEdit(false);
    expect(await call(FORM_MOVE)).toEqual({ status: 403, json: { error: "You can't move this form" } });
    expect(moveForm).not.toHaveBeenCalled();
  });
});
