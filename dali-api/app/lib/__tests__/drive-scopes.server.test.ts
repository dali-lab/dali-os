import { describe, it, expect, vi } from "vitest";

// Mock the prisma client so importing the *.server module (and its transitive
// imports) never instantiates a real DB client. liftOrphans is pure.
vi.mock("~/lib/db", () => ({ prisma: {} }));

import { liftOrphans } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";

const form = (id: string, parentFolderId: string | null): DriveItem => ({
  type: "form",
  id,
  title: id,
  parentFolderId,
  iconEmoji: null,
  updatedAt: new Date(0),
  href: `/forms/edit/${id}`,
});

const folder = (id: string, parentFolderId: string | null): DriveItem => ({
  type: "folder",
  id,
  title: id,
  parentFolderId,
  iconEmoji: null,
  updatedAt: new Date(0),
  href: `/documents/${id}`,
});

// A carved-out space lists a subset of its workspace. The browser builds its
// tree from parentFolderId, so an item pointing at a parent the space doesn't
// hold is never drawn — it disappears from the Drive rather than rendering
// somewhere wrong. That happens as soon as a Core-scoped folder is moved
// inside an unscoped Lab folder.
describe("liftOrphans", () => {
  it("lifts an item whose parent isn't in the space to the top level", () => {
    const out = liftOrphans([folder("core-ish", "some-lab-folder"), form("a", "core-ish")]);
    expect(out.find((i) => i.id === "core-ish")?.parentFolderId).toBeNull();
    // Its own children still resolve, so the subtree stays intact under it.
    expect(out.find((i) => i.id === "a")?.parentFolderId).toBe("core-ish");
  });

  it("leaves items whose parent is present exactly where they are", () => {
    const items = [folder("root", null), form("a", "root"), form("b", null)];
    const out = liftOrphans(items);
    expect(out.map((i) => i.parentFolderId)).toEqual([null, "root", null]);
  });

  it("lifts every orphan, not just the first", () => {
    const out = liftOrphans([form("a", "gone"), form("b", "also-gone")]);
    expect(out.every((i) => i.parentFolderId === null)).toBe(true);
  });

  it("returns items unchanged when nothing is orphaned", () => {
    const items = [folder("root", null), form("a", "root")];
    expect(liftOrphans(items)).toEqual(items);
  });
});
