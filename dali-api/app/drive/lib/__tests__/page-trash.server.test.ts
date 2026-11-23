import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  collectSubtree: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  prisma: { page: { findUnique: h.findUnique, findMany: h.findMany, update: h.update, updateMany: h.updateMany } },
}));
vi.mock("~/lib/pages.server", () => ({ MAX_PAGE_DEPTH: 6, collectSubtree: h.collectSubtree }));

import { archiveDescendants, restorePageSubtree } from "../page-trash.server";

const AT = new Date("2026-11-20T15:00:00Z");

beforeEach(() => vi.resetAllMocks());

describe("archiveDescendants", () => {
  it("trashes every live descendant at the given instant with the extra fields", async () => {
    h.collectSubtree.mockResolvedValue({ ids: ["c1", "c2"], height: 2 });

    expect(await archiveDescendants("root", AT, { labListing: "None" })).toBe(2);

    expect(h.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] }, archivedAt: null },
      data: { labListing: "None", archivedAt: AT },
    });
  });

  it("writes nothing for a page with no children", async () => {
    h.collectSubtree.mockResolvedValue({ ids: [], height: 0 });

    expect(await archiveDescendants("root", AT)).toBe(0);
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});

describe("restorePageSubtree", () => {
  it("restores the root and, level by level, the descendants trashed at the same instant", async () => {
    h.findUnique.mockResolvedValue({ archivedAt: AT });
    h.findMany.mockResolvedValueOnce([{ id: "c1" }]).mockResolvedValueOnce([{ id: "g1" }]).mockResolvedValueOnce([]);

    await restorePageSubtree("root");

    expect(h.update).toHaveBeenCalledWith({ where: { id: "root" }, data: { archivedAt: null } });
    expect(h.findMany.mock.calls[0][0].where).toEqual({ parentPageId: { in: ["root"] }, archivedAt: AT });
    expect(h.findMany.mock.calls[1][0].where).toEqual({ parentPageId: { in: ["c1"] }, archivedAt: AT });
    expect(h.updateMany.mock.calls).toEqual([
      [{ where: { id: { in: ["c1"] } }, data: { archivedAt: null } }],
      [{ where: { id: { in: ["g1"] } }, data: { archivedAt: null } }],
    ]);
  });

  it("leaves children alone when the root was not in the trash", async () => {
    h.findUnique.mockResolvedValue({ archivedAt: null });

    await restorePageSubtree("root");

    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.findMany).not.toHaveBeenCalled();
  });
});
