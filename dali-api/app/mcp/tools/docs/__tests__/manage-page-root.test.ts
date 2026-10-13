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
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("~/lib/drive-receivers.server", () => ({ clearTypeIfLeavingRoot: vi.fn() }));

vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isLabMember: vi.fn(),
  isProjectMember: vi.fn(),
}));

vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

vi.mock("~/lib/page-copy.server", () => ({
  duplicatePage: vi.fn(),
}));

vi.mock("~/lib/user-pages.server", () => ({
  setFavorite: vi.fn(),
}));

vi.mock("~/lib/page-share-access.server", () => ({
  canManageSharing: vi.fn(),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/pages", () => ({
  pageDepth: vi.fn(),
  MAX_PAGE_DEPTH: 2,
  isAncestorOf: vi.fn(),
}));

vi.mock("~/mcp/tools/access", () => ({
  canEditProject: vi.fn(),
}));

vi.mock("~/lib/shortcuts.server", () => ({
  createShortcut: vi.fn(),
  deleteShortcut: vi.fn(),
  ShortcutError: class ShortcutError extends Error {},
}));

import { prisma } from "~/lib/db";
import { runManagePage } from "~/mcp/tools/docs/manage-page";
import { canManageSharing } from "~/lib/page-share-access.server";
import { clearTypeIfLeavingRoot } from "~/lib/drive-receivers.server";

const mockPrisma = prisma as unknown as {
  page: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_page move — Drive roots", () => {
  it("refuses to move a root and writes nothing", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "root1", workspaceType: "Lab", workspaceId: null, kind: "Folder", archivedAt: null,
      createdById: "u1", folderType: "Root", projectAsOverview: null, projectAsPRD: null,
    });

    await expect(
      runManagePage("u1", { action: "move", pageId: "root1", parentPageId: null }),
    ).rejects.toMatchObject({
      name: "ManagePageError",
      status: 400,
      message: "Drive roots can't be moved",
    });
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });
});

describe("manage_page move: receiver lifecycle", () => {
  function folder(over: Record<string, unknown> = {}) {
    return {
      id: "f1", workspaceType: "Lab", workspaceId: null, kind: "Folder", archivedAt: null,
      createdById: "u1", folderType: "HiringForms", projectAsOverview: null, projectAsPRD: null, ...over,
    };
  }

  beforeEach(() => {
    vi.mocked(canManageSharing).mockResolvedValue(true);
    (prisma as any).page.findMany.mockResolvedValue([]);
    (prisma as any).$transaction.mockResolvedValue([]);
    vi.mocked(clearTypeIfLeavingRoot).mockResolvedValue([]);
  });

  it("checks the moved folder after the move and reports what it cleared", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(folder());
    vi.mocked(clearTypeIfLeavingRoot).mockResolvedValue(["f1"]);

    const result = await runManagePage("u1", { action: "move", pageId: "f1", parentPageId: null });

    expect(clearTypeIfLeavingRoot).toHaveBeenCalledWith(["f1"]);
    expect(result).toEqual({ ok: true, clearedReceivers: ["f1"] });
    expect(vi.mocked(clearTypeIfLeavingRoot).mock.invocationCallOrder[0]).toBeGreaterThan(
      (prisma as any).$transaction.mock.invocationCallOrder[0],
    );
  });

  it("includes the children a cross-workspace folder move carries", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(folder());
    (prisma as any).page.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where.parentPageId === "f1" ? [{ id: "c1" }] : []),
    );
    const { isLabMember, isCore } = await import("~/lib/roles");
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(isCore).mockResolvedValue(true);

    await runManagePage("u1", { action: "move", pageId: "f1", parentPageId: null, workspaceType: "Project", workspaceId: "p1" });

    expect(clearTypeIfLeavingRoot).toHaveBeenCalledWith(["f1", "c1"]);
  });

  it("has nothing to check for a plain document", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(folder({ kind: "FreeForm", folderType: null }));
    const result = await runManagePage("u1", { action: "move", pageId: "f1", parentPageId: null });
    expect(clearTypeIfLeavingRoot).toHaveBeenCalledWith([]);
    expect(result).toEqual({ ok: true, clearedReceivers: [] });
  });
});
