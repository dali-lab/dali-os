import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { runUpdatePage, UpdatePageError } from "~/mcp/tools/update-page";

const mockPrisma = prisma as unknown as {
  page: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const basePage = {
  id: "pg1",
  workspaceType: "Project",
  workspaceId: "p1",
  parentPageId: null,
  kind: "FreeForm",
  systemKey: null,
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.page.update.mockResolvedValue({
    id: "pg1",
    title: "T",
    iconEmoji: null,
    parentPageId: null,
    archivedAt: null,
  });
});

describe("update_page", () => {
  it("denies callers who are neither Core nor staffed", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    await expect(runUpdatePage("u1", { pageId: "pg1", title: "x" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("allows non-Core members staffed on the project (web parity)", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    await runUpdatePage("u1", { pageId: "pg1", title: "Renamed" });
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1");
    expect(mockPrisma.page.update).toHaveBeenCalled();
  });

  it("renames and stamps lastEditedBy", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    await runUpdatePage("u1", { pageId: "pg1", title: "  New name  " });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { title: "New name", lastEditedById: "u1" },
      }),
    );
  });

  it("empty iconEmoji clears the icon", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    await runUpdatePage("u1", { pageId: "pg1", iconEmoji: "" });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { iconEmoji: null } }),
    );
  });

  it("refuses to archive a system folder", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      ...basePage,
      kind: "Folder",
      systemKey: "project:p1:team-meeting-notes",
    });
    await expect(
      runUpdatePage("u1", { pageId: "pg1", archived: true }),
    ).rejects.toBeInstanceOf(UpdatePageError);
  });

  it("refuses to archive a folder with live children", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, kind: "Folder" });
    mockPrisma.page.count.mockResolvedValue(2);
    await expect(
      runUpdatePage("u1", { pageId: "pg1", archived: true }),
    ).rejects.toThrow(/inside this folder/);
  });

  it("unarchives", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, archivedAt: new Date() });
    await runUpdatePage("u1", { pageId: "pg1", archived: false });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archivedAt: null } }),
    );
  });

  it("moves under a top-level Folder, appending position", async () => {
    mockPrisma.page.findUnique
      .mockResolvedValueOnce(basePage) // the page
      .mockResolvedValueOnce({
        // the parent
        workspaceType: "Project",
        workspaceId: "p1",
        parentPageId: null,
        kind: "Folder",
        archivedAt: null,
      });
    mockPrisma.page.findFirst.mockResolvedValue({ position: 5 });
    await runUpdatePage("u1", { pageId: "pg1", parentPageId: "folder1" });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { parentPageId: "folder1", position: 6 } }),
    );
  });

  it("rejects moving under a non-Folder", async () => {
    mockPrisma.page.findUnique
      .mockResolvedValueOnce(basePage)
      .mockResolvedValueOnce({
        workspaceType: "Project",
        workspaceId: "p1",
        parentPageId: null,
        kind: "FreeForm",
        archivedAt: null,
      });
    await expect(
      runUpdatePage("u1", { pageId: "pg1", parentPageId: "doc2" }),
    ).rejects.toThrow(/inside a folder/);
  });

  it("rejects moving a Folder", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, kind: "Folder" });
    await expect(
      runUpdatePage("u1", { pageId: "pg1", parentPageId: "folder1" }),
    ).rejects.toThrow(/Folders can't be nested/);
  });

  it("400s when nothing would change", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    await expect(runUpdatePage("u1", { pageId: "pg1" })).rejects.toThrow(/Nothing to update/);
  });

  it("404s non-project pages", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      ...basePage,
      workspaceType: "Lab",
      workspaceId: null,
    });
    await expect(runUpdatePage("u1", { pageId: "pg1", title: "x" })).rejects.toMatchObject({
      status: 404,
    });
  });
});
