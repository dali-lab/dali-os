import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import {
  runSetPageVisibility,
  SET_PAGE_VISIBILITY_TOOL,
} from "~/mcp/tools/projects-extra/set-page-visibility";

const mockPrisma = prisma as unknown as {
  page: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("set_page_visibility", () => {
  it("requires mcp:write scope", () => {
    expect(SET_PAGE_VISIBILITY_TOOL.requiredScope).toBe("mcp:write");
  });

  it("throws McpNotFoundError for non-project pages", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      workspaceType: "Lab",
      workspaceId: "lab1",
      archivedAt: null,
    });
    await expect(
      runSetPageVisibility("u1", { action: "partner", pageId: "pg1", visible: true }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpInvalidError for archived pages", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      workspaceType: "Project",
      workspaceId: "p1",
      archivedAt: new Date(),
    });
    await expect(
      runSetPageVisibility("u1", { action: "partner", pageId: "pg1", visible: true }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpForbiddenError for non-member", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      workspaceType: "Project",
      workspaceId: "p1",
      archivedAt: null,
    });
    await expect(
      runSetPageVisibility("u1", { action: "partner", pageId: "pg1", visible: true }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("sets partnerVisible on partner action", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      workspaceType: "Project",
      workspaceId: "p1",
      archivedAt: null,
    });
    mockPrisma.page.update.mockResolvedValue({});
    const out = await runSetPageVisibility("u1", { action: "partner", pageId: "pg1", visible: true });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.page.update).toHaveBeenCalledWith({
      where: { id: "pg1" },
      data: { partnerVisible: true },
    });
  });

  it("sets publicVisible on public action", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      workspaceType: "Project",
      workspaceId: "p1",
      archivedAt: null,
    });
    mockPrisma.page.update.mockResolvedValue({});
    const out = await runSetPageVisibility("u1", { action: "public", pageId: "pg1", visible: false });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.page.update).toHaveBeenCalledWith({
      where: { id: "pg1" },
      data: { publicVisible: false },
    });
  });
});
