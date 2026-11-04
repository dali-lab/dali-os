import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { page: { findMany: vi.fn() } } }));
vi.mock("~/lib/page-ancestry.server", () => ({ loadAncestorChains: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { loadAncestorChains } from "~/lib/page-ancestry.server";
import { moveConstraintFor } from "~/lib/move-constraint.server";

const m = prisma as any;
const page = (over: Record<string, unknown>) => ({
  id: "x",
  parentPageId: null,
  folderType: null,
  workspaceType: "Lab",
  workspaceId: null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadAncestorChains).mockResolvedValue(
    new Map([["notebooks", [{ id: "notebooks" }, { id: "mroot", folderType: "Root", title: "Mentorship" }]]]) as never,
  );
});

describe("moveConstraintFor", () => {
  it("pins a page under a typed root to that root", async () => {
    m.page.findMany.mockResolvedValue([page({ parentPageId: "notebooks" })]);
    expect(await moveConstraintFor(["x"])).toEqual({ rootFolderIds: ["mroot"], workspaces: [] });
  });

  it("pins a system folder to its workspace", async () => {
    m.page.findMany.mockResolvedValue([
      page({ folderType: "OfferingForms", workspaceType: "EducationOffering", workspaceId: "off" }),
    ]);
    expect(await moveConstraintFor(["x"])).toEqual({
      rootFolderIds: [],
      workspaces: [{ type: "EducationOffering", id: "off" }],
    });
  });

  it("is unconstrained for plain pages, and reports every root for a mixed bulk move", async () => {
    m.page.findMany.mockResolvedValue([page({})]);
    expect(await moveConstraintFor(["x"])).toEqual({ rootFolderIds: [], workspaces: [] });

    vi.mocked(loadAncestorChains).mockResolvedValue(
      new Map([
        ["a", [{ id: "croot", folderType: "Root", title: "Core" }]],
        ["b", [{ id: "mroot", folderType: "Root", title: "Mentorship" }]],
      ]) as never,
    );
    m.page.findMany.mockResolvedValue([page({ parentPageId: "a" }), page({ parentPageId: "b" })]);
    expect((await moveConstraintFor(["x", "y"])).rootFolderIds.sort()).toEqual(["croot", "mroot"]);
  });
});
