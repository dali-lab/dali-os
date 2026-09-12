import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpInvalidError extends Error {
    status: number;
    constructor(message = "Invalid params") {
      super(message);
      this.name = "McpInvalidError";
      this.status = 400;
    }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});

vi.mock("~/lib/db", () => ({
  prisma: {
    page: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    projectFile: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    form: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    emailTemplate: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isLabMember: vi.fn(),
  isProjectMember: vi.fn(),
  canViewForms: vi.fn(),
}));

vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

vi.mock("~/lib/fileAccess.server", () => ({
  canEditFile: vi.fn(),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock the dynamic import for formDeletionBlockers
vi.mock("~/forms/lib/form-usages.server", () => ({
  formDeletionBlockers: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import { canViewForms, isCore, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import {
  LIST_DRIVE_TRASH_TOOL,
  runListDriveTrash,
} from "~/mcp/tools/docs/list-drive-trash";
import {
  MANAGE_DRIVE_TRASH_TOOL_DEF,
  runManageDriveTrash,
  ManageDriveTrashError,
} from "~/mcp/tools/docs/manage-drive-trash";
import {
  MOVE_DRIVE_ITEM_TOOL,
  runMoveDriveItem,
  MoveDriveItemError,
} from "~/mcp/tools/docs/move-drive-item";

const mockPrisma = prisma as unknown as {
  page: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  projectFile: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  form: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  emailTemplate: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list_drive_trash ─────────────────────────────────────────────────────────

describe("list_drive_trash", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_DRIVE_TRASH_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns accessible archived items sorted by archivedAt desc", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "p1", title: "Old doc", archivedAt: new Date("2026-01-01"), kind: "FreeForm" },
    ]);
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: false, canEdit: false } as never);
    mockPrisma.projectFile.findMany.mockResolvedValue([]);
    mockPrisma.form.findMany.mockResolvedValue([
      { id: "f1", name: "App Form", archivedAt: new Date("2026-03-01") },
    ]);

    const out = await runListDriveTrash("u1");
    expect(out.items).toHaveLength(2);
    expect(out.items[0].id).toBe("f1"); // newer archivedAt
    expect(out.items[1].id).toBe("p1");
  });

  it("excludes pages the caller cannot view", async () => {
    vi.mocked(canViewForms).mockResolvedValue(false);
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "p1", title: "Secret", archivedAt: new Date("2026-01-01"), kind: "FreeForm" },
    ]);
    vi.mocked(getPageAccess).mockResolvedValue({ canView: false, canComment: false, canEdit: false } as never);
    mockPrisma.projectFile.findMany.mockResolvedValue([]);

    const out = await runListDriveTrash("u1");
    expect(out.items).toHaveLength(0);
  });
});

// ─── manage_drive_trash ───────────────────────────────────────────────────────

describe("manage_drive_trash", () => {
  it("requires the mcp:write scope", () => {
    expect(MANAGE_DRIVE_TRASH_TOOL_DEF.requiredScope).toBe("mcp:write");
  });

  it("restores an archived doc page", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: true, canEdit: true } as never);
    mockPrisma.page.update.mockResolvedValue({ id: "p1" });

    const out = await runManageDriveTrash("u1", { action: "restore", type: "doc", id: "p1" });
    expect(out).toEqual({ ok: true });
    expect(mockPrisma.page.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { archivedAt: null } });
  });

  it("rejects restore of doc when caller lacks edit access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: false, canEdit: false } as never);
    await expect(
      runManageDriveTrash("u1", { action: "restore", type: "doc", id: "p1" }),
    ).rejects.toMatchObject({ name: "ManageDriveTrashError", status: 403 });
  });

  it("purges a file for an edit-capable caller", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "file1", projectId: "proj1", workspaceType: null, workspaceId: null, folderPageId: null, archivedAt: new Date(),
    });
    vi.mocked(canEditFile).mockResolvedValue(true);
    mockPrisma.projectFile.delete.mockResolvedValue({ id: "file1" });

    const out = await runManageDriveTrash("u1", { action: "purge", type: "file", id: "file1" });
    expect(out).toEqual({ ok: true });
    expect(mockPrisma.projectFile.delete).toHaveBeenCalledWith({ where: { id: "file1" } });
  });

  it("rejects file operations when caller lacks edit access", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "file1", projectId: "proj1", workspaceType: null, workspaceId: null, folderPageId: null,
    });
    vi.mocked(canEditFile).mockResolvedValue(false);
    await expect(
      runManageDriveTrash("u1", { action: "restore", type: "file", id: "file1" }),
    ).rejects.toMatchObject({ name: "ManageDriveTrashError", status: 403 });
  });

  it("restores a form for a canViewForms caller", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);
    mockPrisma.form.findUnique.mockResolvedValue({ id: "frm1", archivedAt: new Date() });
    mockPrisma.form.update.mockResolvedValue({ id: "frm1" });

    const out = await runManageDriveTrash("u1", { action: "restore", type: "form", id: "frm1" });
    expect(out).toEqual({ ok: true });
  });

  it("rejects form operations when caller lacks canViewForms", async () => {
    vi.mocked(canViewForms).mockResolvedValue(false);
    await expect(
      runManageDriveTrash("u1", { action: "restore", type: "form", id: "frm1" }),
    ).rejects.toMatchObject({ name: "ManageDriveTrashError", status: 403 });
  });
});

// ─── move_drive_item ──────────────────────────────────────────────────────────

describe("move_drive_item", () => {
  it("requires the mcp:write scope", () => {
    expect(MOVE_DRIVE_ITEM_TOOL.requiredScope).toBe("mcp:write");
  });

  it("moves a file to a folder for Core/project-member", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({ projectId: "proj1", archivedAt: null });
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({ id: "folder1", kind: "Folder", archivedAt: null });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: true, canEdit: true } as never);
    mockPrisma.projectFile.update.mockResolvedValue({ id: "file1" });

    const out = await runMoveDriveItem("u1", { itemType: "file", itemId: "file1", destFolderPageId: "folder1" });
    expect(out).toEqual({ ok: true });
    expect(mockPrisma.projectFile.update).toHaveBeenCalledWith({
      where: { id: "file1" },
      data: { folderPageId: "folder1" },
    });
  });

  it("unplaces a file when destFolderPageId is null", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({ projectId: "proj1", archivedAt: null });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.projectFile.update.mockResolvedValue({ id: "file1" });

    const out = await runMoveDriveItem("u1", { itemType: "file", itemId: "file1", destFolderPageId: undefined });
    expect(out).toEqual({ ok: true });
    // No folder check needed
    expect(mockPrisma.page.findUnique).not.toHaveBeenCalled();
  });

  it("rejects file move when caller has no access", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({ projectId: "proj1", archivedAt: null });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);

    await expect(
      runMoveDriveItem("u1", { itemType: "file", itemId: "file1", destFolderPageId: undefined }),
    ).rejects.toMatchObject({ name: "MoveDriveItemError", status: 403 });
  });

  it("rejects move to a non-Folder page", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({ projectId: "proj1", archivedAt: null });
    vi.mocked(isCore).mockResolvedValue(true);
    // Dest is a FreeForm doc, not a Folder
    mockPrisma.page.findUnique.mockResolvedValue({ id: "doc1", kind: "FreeForm", archivedAt: null });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: true, canEdit: true } as never);

    await expect(
      runMoveDriveItem("u1", { itemType: "file", itemId: "file1", destFolderPageId: "doc1" }),
    ).rejects.toMatchObject({ name: "MoveDriveItemError", status: 404 });
  });

  it("rejects move when caller can't edit the destination folder", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({ projectId: "proj1", archivedAt: null });
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({ id: "folder1", kind: "Folder", archivedAt: null });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: false, canEdit: false } as never);

    await expect(
      runMoveDriveItem("u1", { itemType: "file", itemId: "file1", destFolderPageId: "folder1" }),
    ).rejects.toMatchObject({ name: "MoveDriveItemError", status: 403 });
  });
});
