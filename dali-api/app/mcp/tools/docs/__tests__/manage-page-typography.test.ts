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
  },
}));

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

import { prisma } from "~/lib/db";
import { getPageAccess } from "~/lib/pageAccess.server";
import { MANAGE_PAGE_TOOL_DEF, runManagePage, ManagePageError } from "~/mcp/tools/docs/manage-page";

const mockPrisma = prisma as unknown as {
  page: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_page tool def", () => {
  it("includes typography in the action enum", () => {
    const actions = (MANAGE_PAGE_TOOL_DEF.inputSchema.properties as Record<string, { enum?: string[] }>).action?.enum;
    expect(actions).toContain("typography");
  });

  it("requires the mcp:write scope", () => {
    expect(MANAGE_PAGE_TOOL_DEF.requiredScope).toBe("mcp:write");
  });
});

describe("manage_page typography action", () => {
  it("rejects non-FreeForm pages", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "p1", workspaceType: "Lab", workspaceId: null, archivedAt: null, kind: "Folder",
    });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: true, canEdit: true } as never);

    await expect(
      runManagePage("u1", { action: "typography", pageId: "p1", font: "serif", smallText: false, fullWidth: false }),
    ).rejects.toMatchObject({ name: "ManagePageError", status: 400 });
  });

  it("rejects callers without edit access", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "p1", workspaceType: "Lab", workspaceId: null, archivedAt: null, kind: "FreeForm",
    });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: false, canEdit: false } as never);

    await expect(
      runManagePage("u1", { action: "typography", pageId: "p1", font: "serif", smallText: false, fullWidth: false }),
    ).rejects.toMatchObject({ name: "ManagePageError", status: 403 });
  });

  it("updates typography for an authorized editor", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "p1", workspaceType: "Project", workspaceId: "proj1", archivedAt: null, kind: "FreeForm",
    });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: true, canEdit: true } as never);
    mockPrisma.page.update.mockResolvedValue({ id: "p1" });

    const out = await runManagePage("u1", {
      action: "typography",
      pageId: "p1",
      font: "mono",
      smallText: true,
      fullWidth: false,
      nestingGuides: true,
    });
    expect(out).toEqual({ ok: true });
    expect(mockPrisma.page.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: {
        typography: { font: "mono", smallText: true, fullWidth: false, nestingGuides: true },
      },
    });
  });

  it("defaults nestingGuides to false when omitted", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "p1", workspaceType: "Lab", workspaceId: null, archivedAt: null, kind: "FreeForm",
    });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: true, canEdit: true } as never);
    mockPrisma.page.update.mockResolvedValue({ id: "p1" });

    await runManagePage("u1", { action: "typography", pageId: "p1", font: "default", smallText: false, fullWidth: true });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { typography: { font: "default", smallText: false, fullWidth: true, nestingGuides: false } },
      }),
    );
  });

  it("returns 404 for a missing or archived page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);
    await expect(
      runManagePage("u1", { action: "typography", pageId: "bad", font: "serif", smallText: false, fullWidth: false }),
    ).rejects.toMatchObject({ name: "ManagePageError", status: 404 });
  });
});
