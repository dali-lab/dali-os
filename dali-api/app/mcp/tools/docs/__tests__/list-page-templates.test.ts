import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isLabMember: vi.fn(),
  isProjectMember: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import {
  LIST_PAGE_TEMPLATES_TOOL,
  runListPageTemplates,
  ListPageTemplatesError,
} from "~/mcp/tools/docs/list-page-templates";

const mockPrisma = prisma as unknown as {
  page: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_page_templates", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_PAGE_TEMPLATES_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects Project scope without workspaceId", async () => {
    await expect(
      runListPageTemplates("u1", { workspaceType: "Project" }),
    ).rejects.toMatchObject({ name: "ListPageTemplatesError", status: 400 });
  });

  it("returns empty list when caller has no access", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isLabMember).mockResolvedValue(false);
    const out = await runListPageTemplates("u1", { workspaceType: "Lab" });
    expect(out).toEqual({ templates: [] });
    expect(mockPrisma.page.findMany).not.toHaveBeenCalled();
  });

  it("returns templates for lab members", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isLabMember).mockResolvedValue(true);
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "t1", title: "Project Charter", iconEmoji: "📋" },
    ]);

    const out = await runListPageTemplates("u1", { workspaceType: "Lab" });
    expect(out.templates).toHaveLength(1);
    expect(out.templates[0]).toMatchObject({ id: "t1", title: "Project Charter" });
  });

  it("returns templates for project members", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "t2", title: "Sprint Plan", iconEmoji: null },
    ]);

    const out = await runListPageTemplates("u1", { workspaceType: "Project", workspaceId: "proj1" });
    expect(out.templates[0]).toMatchObject({ id: "t2", iconEmoji: null });
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceType: "Project", workspaceId: "proj1", isTemplate: true }),
      }),
    );
  });

  it("Core always gets access", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findMany.mockResolvedValue([]);
    const out = await runListPageTemplates("u1", { workspaceType: "Lab" });
    expect(out.templates).toEqual([]);
    expect(mockPrisma.page.findMany).toHaveBeenCalled();
  });
});
