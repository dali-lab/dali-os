import { describe, it, expect } from "vitest";
import { folderSubtree } from "./ProjectDriveTab";
import type { DriveItem } from "~/lib/drive.server";

const item = (id: string, parentFolderId: string | null) => ({ id, parentFolderId }) as unknown as DriveItem;

describe("folderSubtree", () => {
  const items = [item("a", null), item("b", "a"), item("c", "b"), item("d", null), item("e", "d")];

  it("includes the folder and everything under it", () => {
    expect([...folderSubtree(items, "a")].sort()).toEqual(["a", "b", "c"]);
  });

  it("excludes siblings and their children", () => {
    const subtree = folderSubtree(items, "b");
    expect(subtree.has("d")).toBe(false);
    expect(subtree.has("e")).toBe(false);
    expect(subtree.has("a")).toBe(false);
  });

  it("returns just the root for a leaf", () => {
    expect([...folderSubtree(items, "e")]).toEqual(["e"]);
  });
});
