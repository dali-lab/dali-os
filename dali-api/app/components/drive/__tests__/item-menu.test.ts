import { describe, expect, it } from "vitest";
import { menuEntries } from "~/components/drive/item-menu";
import type { DriveItem } from "~/drive/lib/drive.server";

const at = new Date("2026-01-01T00:00:00Z");
const base = { id: "i", title: "T", parentFolderId: null, updatedAt: at, href: "/x" };
const item = (type: string, extra: Record<string, unknown> = {}) =>
  ({ ...base, type, iconEmoji: null, ...extra }) as DriveItem;
const all = { share: true, favorite: true, partner: true };
const none = { share: false, favorite: false, partner: false };

describe("menuEntries", () => {
  it("offers Download on files, even read-only, and on nothing else", () => {
    expect(menuEntries(item("file"), none)).toContain("download");
    expect(menuEntries(item("file"), { ...none, readOnly: true })).toContain("download");
    for (const type of ["doc", "folder", "form", "agreement", "rubric"]) {
      expect(menuEntries(item(type), all)).not.toContain("download");
    }
  });

  it("offers the full set for a page", () => {
    expect(menuEntries(item("doc"), all)).toEqual([
      "open",
      "favorite",
      "share",
      "partner",
      "rename",
      "move",
      "delete",
    ]);
  });

  it("offers Favorite and Share on a form", () => {
    const entries = menuEntries(item("form"), all);
    expect(entries).toContain("favorite");
    expect(entries).toContain("share");
    expect(menuEntries(item("form"), { ...all, favorite: false })).not.toContain("favorite");
    expect(menuEntries(item("form"), { ...none })).not.toContain("share");
  });

  it("offers Share on files, after Download, when the row can share", () => {
    expect(menuEntries(item("file"), all)).toEqual(["open", "download", "share", "partner", "rename", "move", "delete"]);
    expect(menuEntries(item("file"), none)).not.toContain("share");
  });

  it("does not offer Share on agreements or rubrics", () => {
    for (const type of ["agreement", "rubric"]) {
      expect(menuEntries(item(type), all)).not.toContain("share");
    }
  });

  it("still offers no Favorite on a file, agreement or rubric", () => {
    for (const type of ["file", "agreement", "rubric"]) {
      expect(menuEntries(item(type), all)).not.toContain("favorite");
    }
  });

  it("leaves Rename, Move and Delete off in a read-only space", () => {
    expect(menuEntries(item("doc"), { ...all, readOnly: true })).toEqual([
      "open",
      "favorite",
      "share",
      "partner",
    ]);
    expect(menuEntries(item("file"), { ...none, readOnly: true })).toEqual(["open", "download"]);
  });

  it("keeps a file's menu in order", () => {
    expect(menuEntries(item("file"), none)).toEqual(["open", "download", "rename", "move", "delete"]);
    expect(menuEntries(item("agreement"), none)).toEqual(["open", "rename", "move"]);
    expect(menuEntries(item("rubric"), none)).toEqual(["open", "move"]);
  });
});
