import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    projectFile: {
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
  runSetFilePartnerVisibility,
  SET_FILE_PARTNER_VISIBILITY_TOOL,
} from "~/mcp/tools/projects-extra/set-file-partner-visibility";

const mockPrisma = prisma as unknown as {
  projectFile: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("set_file_partner_visibility", () => {
  it("requires mcp:write scope", () => {
    expect(SET_FILE_PARTNER_VISIBILITY_TOOL.requiredScope).toBe("mcp:write");
  });

  it("throws McpNotFoundError for missing file", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectFile.findUnique.mockResolvedValue(null);
    await expect(
      runSetFilePartnerVisibility("u1", { fileId: "f-nope", partnerVisible: true }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpNotFoundError for archived file", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "f1",
      projectId: "p1",
      archivedAt: new Date(),
    });
    await expect(
      runSetFilePartnerVisibility("u1", { fileId: "f1", partnerVisible: true }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpForbiddenError for non-member", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "f1",
      projectId: "p1",
      archivedAt: null,
    });
    await expect(
      runSetFilePartnerVisibility("u1", { fileId: "f1", partnerVisible: true }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("updates partnerVisible to true", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "f1",
      projectId: "p1",
      archivedAt: null,
    });
    mockPrisma.projectFile.update.mockResolvedValue({});
    const out = await runSetFilePartnerVisibility("u1", { fileId: "f1", partnerVisible: true });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.projectFile.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { partnerVisible: true },
    });
  });

  it("updates partnerVisible to false for project member", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "f1",
      projectId: "p1",
      archivedAt: null,
    });
    mockPrisma.projectFile.update.mockResolvedValue({});
    const out = await runSetFilePartnerVisibility("u2", { fileId: "f1", partnerVisible: false });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.projectFile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { partnerVisible: false } }),
    );
  });
});
