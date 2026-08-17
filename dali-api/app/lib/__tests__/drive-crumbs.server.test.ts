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
