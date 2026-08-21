import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { page: { findUnique: vi.fn() } },
}));

vi.mock("../pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { getPageAccess } from "../pageAccess.server";
import { driveFolderCrumbs } from "../drive-crumbs.server";

const mockPrisma = prisma as any;

// A tiny Drive tree: a doc parented under "sub", itself under the Core root.
//   Core (drive:core-root) ▸ Subfolder(sub) ▸ <doc>
const TREE: Record<string, any> = {
  sub: { id: "sub", title: "Subfolder", iconEmoji: null, parentPageId: "core-root", systemKey: null },
  "core-root": {
    id: "core-root",
    title: "Core",
    iconEmoji: null,
    parentPageId: null,
    systemKey: "drive:core-root",
  },
  // A plain Lab folder (no scope) directly under the Lab drive root.
  labfolder: {
    id: "labfolder",
    title: "Team Notes",
    iconEmoji: null,
    parentPageId: null,
    systemKey: null,
  },
  // Folders in the non-Lab workspaces — the scope comes from workspaceType.
  projfolder: {
    id: "projfolder",
    title: "Sprint Docs",
    iconEmoji: null,
    parentPageId: null,
    systemKey: null,
    workspaceType: "Project",
    archivedAt: null,
  },
  edufolder: {
    id: "edufolder",
    title: "Forms",
    iconEmoji: null,
    parentPageId: null,
    systemKey: null,
    workspaceType: "EducationOffering",
    archivedAt: null,
  },
  memfolder: {
    id: "memfolder",
    title: "Private Notes",
    iconEmoji: null,
    parentPageId: null,
    systemKey: null,
    workspaceType: "Member",
    archivedAt: null,
  },
  // An archived Lab folder — its items are orphaned, so the crumb collapses.
  archived: {
    id: "archived",
    title: "Old Stuff",
    iconEmoji: null,
    parentPageId: null,
    systemKey: null,
    workspaceType: "Lab",
    archivedAt: new Date("2026-01-01"),
  },
};

const grant = { canView: true, canEdit: true, canComment: true, canResolve: true };
const deny = { canView: false, canEdit: false, canComment: false, canResolve: false };

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.page.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(TREE[where.id] ?? null),
  );
});

describe("driveFolderCrumbs access filtering", () => {
  it("collapses a Core-scoped path to the Lab drive and drops folders for a non-member", async () => {
    // Viewer reaches the doc via General access but can't view the Core folder
    // or its subfolder.
    vi.mocked(getPageAccess).mockResolvedValue(deny as any);

    const crumbs = await driveFolderCrumbs("sub", "outsider");

    expect(crumbs.scope).toBe("lab");
    expect(crumbs.folders).toEqual([]);
  });

  it("keeps the Core scope and the full folder path for a member", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(grant as any);

    const crumbs = await driveFolderCrumbs("sub", "core-member");

    expect(crumbs.scope).toBe("core");
    expect(crumbs.folders).toEqual([{ id: "sub", title: "Subfolder", iconEmoji: null }]);
  });

  it("keeps ordinary Lab folder crumbs the viewer can view", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(grant as any);

    const crumbs = await driveFolderCrumbs("labfolder", "lab-member");

    expect(crumbs.scope).toBe("lab");
    expect(crumbs.folders).toEqual([{ id: "labfolder", title: "Team Notes", iconEmoji: null }]);
  });

  it("returns the Lab root with no folders when there is no parent", async () => {
    const crumbs = await driveFolderCrumbs(null, "anyone");

    expect(crumbs).toEqual({ scope: "lab", folders: [] });
    expect(getPageAccess).not.toHaveBeenCalled();
  });
});

describe("driveFolderCrumbs workspace scope", () => {
  beforeEach(() => vi.mocked(getPageAccess).mockResolvedValue(grant as any));

  it("maps a Project-workspace folder to the projects scope", async () => {
    const crumbs = await driveFolderCrumbs("projfolder", "member");
    expect(crumbs.scope).toBe("projects");
    expect(crumbs.folders).toEqual([{ id: "projfolder", title: "Sprint Docs", iconEmoji: null }]);
  });

  it("maps an EducationOffering-workspace folder to the education scope", async () => {
    const crumbs = await driveFolderCrumbs("edufolder", "member");
    expect(crumbs.scope).toBe("education");
    expect(crumbs.folders).toEqual([{ id: "edufolder", title: "Forms", iconEmoji: null }]);
  });

  it("maps a Member-workspace folder to the mine scope", async () => {
    const crumbs = await driveFolderCrumbs("memfolder", "owner");
    expect(crumbs.scope).toBe("mine");
    expect(crumbs.folders).toEqual([{ id: "memfolder", title: "Private Notes", iconEmoji: null }]);
  });

  it("collapses an archived leaf folder to the General root (orphan)", async () => {
    const crumbs = await driveFolderCrumbs("archived", "anyone");
    expect(crumbs).toEqual({ scope: "lab", folders: [] });
    // Orphan collapse happens before any access resolution.
    expect(getPageAccess).not.toHaveBeenCalled();
  });
});
