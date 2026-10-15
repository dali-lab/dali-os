import { describe, expect, it } from "vitest";
import { menuEntries } from "~/components/drive/item-menu";
import type { DriveItem } from "~/lib/drive.server";

const at = new Date("2026-01-01T00:00:00Z");
const base = { id: "i", title: "T", parentFolderId: null, updatedAt: at, href: "/x" };
const item = (type: string, extra: Record<string, unknown> = {}) =>
  ({ ...base, type, iconEmoji: null, ...extra }) as DriveItem;
const all = { share: true, favorite: true, partner: true };
const none = { share: false, favorite: false, partner: false };

describe("menuEntries", () => {
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

  it("offers Favorite on a form, but never Share", () => {
    const entries = menuEntries(item("form"), all);
    expect(entries).toContain("favorite");
    expect(entries).not.toContain("share");
    expect(menuEntries(item("form"), { ...all, favorite: false })).not.toContain("favorite");
  });

  it("offers Share on a form once forms follow page access, and only then", () => {
    expect(menuEntries(item("form"), { ...all, formShare: true })).toContain("share");
    expect(menuEntries(item("form"), { ...all, formShare: false })).not.toContain("share");
    expect(menuEntries(item("form"), { ...none, formShare: true })).not.toContain("share");
  });

  it("formShare does not widen Share to files or agreements", () => {
    for (const type of ["file", "agreement", "rubric"]) {
      expect(menuEntries(item(type), { ...all, formShare: true })).not.toContain("share");
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
    expect(menuEntries(item("file"), { ...none, readOnly: true })).toEqual(["open"]);
  });

  it("keeps a file's menu as it was", () => {
    expect(menuEntries(item("file"), none)).toEqual(["open", "rename", "move", "delete"]);
    expect(menuEntries(item("agreement"), none)).toEqual(["open", "rename"]);
    expect(menuEntries(item("rubric"), none)).toEqual(["open"]);
  });
});
