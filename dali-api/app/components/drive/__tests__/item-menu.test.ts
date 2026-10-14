import { describe, expect, it } from "vitest";
import { menuEntries } from "~/components/drive/item-menu";
import type { DriveItem } from "~/lib/drive.server";

const at = new Date("2026-01-01T00:00:00Z");
const base = { id: "i", title: "T", parentFolderId: null, updatedAt: at, href: "/x" };
const item = (type: string, extra: Record<string, unknown> = {}) =>
  ({ ...base, type, iconEmoji: null, ...extra }) as DriveItem;
const shortcut = (extra: Record<string, unknown> = {}) =>
  item("shortcut", { targetId: "t", targetType: "doc", canOpen: true, originalInTrash: false, ...extra });

const all = { share: true, fileIn: true, favorite: true, partner: true };
const none = { share: false, fileIn: false, favorite: false, partner: false };

describe("menuEntries", () => {
  it("offers File in… and Add shortcut to… beside Move to… for a page that can be filed", () => {
    expect(menuEntries(item("doc"), all)).toEqual([
      "open",
      "favorite",
      "share",
      "partner",
      "rename",
      "move",
      "file-in",
      "add-shortcut",
      "delete",
    ]);
    expect(menuEntries(item("folder"), { ...all, partner: false })).toContain("file-in");
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

  it("leaves them out when the item can't be filed", () => {
    expect(menuEntries(item("doc"), { ...all, fileIn: false })).not.toContain("file-in");
    expect(menuEntries(item("file"), { ...all, fileIn: false })).not.toContain("add-shortcut");
  });

  it("leaves Rename, Move and Delete off in a read-only space", () => {
    expect(menuEntries(item("doc"), { ...all, readOnly: true })).toEqual([
      "open",
      "favorite",
      "share",
      "partner",
      "file-in",
      "add-shortcut",
    ]);
    expect(menuEntries(item("file"), { ...none, readOnly: true })).toEqual(["open"]);
  });

  it("keeps a file's menu as it was", () => {
    expect(menuEntries(item("file"), none)).toEqual(["open", "rename", "move", "delete"]);
    expect(menuEntries(item("agreement"), none)).toEqual(["open", "rename"]);
    expect(menuEntries(item("rubric"), none)).toEqual(["open"]);
  });

  it("lets a shortcut be opened, moved and deleted, but not renamed, shared or filed", () => {
    expect(menuEntries(shortcut(), { ...all, fileIn: false })).toEqual(["open", "move", "delete"]);
  });

  it("offers only Delete for a shortcut the viewer can't open", () => {
    expect(menuEntries(shortcut({ canOpen: false }), all)).toEqual(["delete"]);
    expect(menuEntries(shortcut({ canOpen: false, originalInTrash: true }), all)).toEqual(["delete"]);
  });
});
