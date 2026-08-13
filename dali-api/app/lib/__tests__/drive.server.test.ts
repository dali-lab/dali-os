import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
  // Files use this via canViewFile; default false → unscoped files stay visible.
  isUnderGoverningScope: vi.fn().mockResolvedValue(false),
}));

import { prisma } from "~/lib/db";
import { getPageAccess } from "~/lib/pageAccess.server";
import { loadDriveScope } from "~/lib/drive.server";

const mockPrisma = prisma as unknown as {
  page: { findMany: ReturnType<typeof vi.fn> };
  projectFile: { findMany: ReturnType<typeof vi.fn> };
  form: { findMany: ReturnType<typeof vi.fn> };
};

const VIEW_ONLY = { canView: true, canEdit: false, canComment: false, canManageAccess: false };
const DENIED = { canView: false, canEdit: false, canComment: false, canManageAccess: false };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty results
  mockPrisma.page.findMany.mockResolvedValue([]);
  mockPrisma.projectFile.findMany.mockResolvedValue([]);
  mockPrisma.form.findMany.mockResolvedValue([]);
  vi.mocked(getPageAccess).mockResolvedValue(VIEW_ONLY as any);
});

describe("loadDriveScope — Lab scope", () => {
  it("returns lab-scoped files as DriveItems with type='file'", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      {
        id: "f1",
        title: "Logo",
        folderPageId: null,
        updatedAt: new Date("2026-08-11T00:00:00Z"),
      },
    ]);

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    const file = items.find((i) => i.id === "f1");
    expect(file).toBeDefined();
    expect(file?.type).toBe("file");
    expect(file?.href).toBe("/documents/file/f1");
  });

  it("queries projectFile with workspaceType=Lab, archivedAt=null (no-widening: never fetches project files)", async () => {
    await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(mockPrisma.projectFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceType: "Lab", archivedAt: null }),
      }),
    );
    // Must NOT include a projectId filter that could leak project-scoped files.
    const callArg = mockPrisma.projectFile.findMany.mock.calls[0][0];
    expect(callArg.where).not.toHaveProperty("projectId");
  });

  it("places the file at its folderPageId as parentFolderId", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      {
        id: "f2",
        title: "Brand Kit",
        folderPageId: "folder-1",
        updatedAt: new Date("2026-08-11T00:00:00Z"),
      },
    ]);

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    const file = items.find((i) => i.id === "f2");
    expect(file?.parentFolderId).toBe("folder-1");
  });

  it("excludes forms when canViewForms is false (default)", async () => {
    await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(mockPrisma.form.findMany).not.toHaveBeenCalled();
  });

  it("includes forms when canViewForms is true", async () => {
    mockPrisma.form.findMany.mockResolvedValue([
      { id: "form1", name: "Application", folderPageId: null, updatedAt: new Date() },
    ]);
    const items = await loadDriveScope({
      userSub: "u1",
      scope: { kind: "Lab" },
      canViewForms: true,
    });
    expect(items.some((i) => i.type === "form")).toBe(true);
  });

  it("filters out pages the viewer cannot see via getPageAccess", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "pg-secret",
        title: "Secret",
        kind: "FreeForm",
        parentPageId: null,
        iconEmoji: null,
        updatedAt: new Date(),
        workspaceType: "Lab",
        workspaceId: null,
        archivedAt: null,
        createdById: "other",
        partnerVisible: false,
        profileVisible: false,
        labListing: false,
        linkAccess: "Disabled",
        linkPermission: "View",
        scopeKind: null,
        scopeGroupId: null,
        scopePermission: null,
      },
    ]);
    vi.mocked(getPageAccess).mockResolvedValue(DENIED as any);

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(items.find((i) => i.id === "pg-secret")).toBeUndefined();
  });
});

describe("loadDriveScope — Project scope", () => {
  it("returns project-scoped files, not lab files", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      { id: "pf1", title: "Report", folderPageId: null, updatedAt: new Date() },
    ]);

    const items = await loadDriveScope({
      userSub: "u1",
      scope: { kind: "Project", projectId: "proj-1" },
    });

    // Should query by projectId, NOT workspaceType
    const callArg = mockPrisma.projectFile.findMany.mock.calls[0][0];
    expect(callArg.where).toHaveProperty("projectId");
    expect(callArg.where).not.toHaveProperty("workspaceType");
    expect(items.some((i) => i.id === "pf1")).toBe(true);
  });
});
