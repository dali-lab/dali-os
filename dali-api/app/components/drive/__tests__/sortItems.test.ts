import { describe, expect, it } from "vitest";
import type { DriveItem } from "~/drive/lib/drive.server";
import { sortItems } from "../browser-items";

const item = (over: Partial<DriveItem> & { id: string; title: string }): DriveItem =>
  ({ type: "page", updatedAt: "2026-01-01T00:00:00Z", ...over }) as DriveItem;

const items = [
  item({ id: "b", title: "Beta", updatedAt: "2026-03-01T00:00:00Z", sizeBytes: 10 }),
  item({ id: "a", title: "alpha", updatedAt: "2026-01-01T00:00:00Z", sizeBytes: 300 }),
  item({ id: "f", title: "Zeta folder", type: "folder", updatedAt: "2026-02-01T00:00:00Z" }),
];

describe("sortItems", () => {
  it("puts folders first whatever the key and direction", () => {
    for (const key of ["name", "modified", "size", "shared"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        expect(sortItems(items, key, dir)[0].id).toBe("f");
      }
    }
  });

  it("sorts names case-insensitively in both directions", () => {
    expect(sortItems(items, "name", "asc").map((i) => i.id)).toEqual(["f", "a", "b"]);
    expect(sortItems(items, "name", "desc").map((i) => i.id)).toEqual(["f", "b", "a"]);
  });

  it("sorts by modified and size", () => {
    expect(sortItems(items, "modified", "desc").map((i) => i.id)).toEqual(["f", "b", "a"]);
    expect(sortItems(items, "modified", "asc").map((i) => i.id)).toEqual(["f", "a", "b"]);
    expect(sortItems(items, "size", "desc").map((i) => i.id)).toEqual(["f", "a", "b"]);
    expect(sortItems(items, "size", "asc").map((i) => i.id)).toEqual(["f", "b", "a"]);
  });

  it("does not mutate its input", () => {
    const copy = [...items];
    sortItems(items, "name", "desc");
    expect(items).toEqual(copy);
  });
});
