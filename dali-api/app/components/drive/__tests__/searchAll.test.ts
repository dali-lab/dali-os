import { describe, expect, it } from "vitest";
import { searchAll } from "~/components/drive/DriveBrowser";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";

const at = new Date("2026-01-01T00:00:00Z");

function doc(id: string, title: string, parentFolderId: string | null = null): DriveItem {
  return { type: "doc", id, title, parentFolderId, iconEmoji: null, updatedAt: at, href: `/documents/${id}` };
}
function folder(id: string, title: string): DriveItem {
  return { type: "folder", id, title, parentFolderId: null, iconEmoji: null, updatedAt: at, href: `/documents/${id}` };
}
function file(id: string, title: string): DriveItem {
  return { type: "file", id, title, parentFolderId: null, iconEmoji: null, updatedAt: at, href: `/documents/file/${id}` };
}

const scopes: DriveTreeScope[] = [
  {
    id: "mine",
    label: "My Drive",
    iconEmoji: null,
    items: [folder("f1", "Onboarding"), doc("d1", "Handbook", "f1"), doc("d2", "Retro notes")],
  },
  { id: "lab", label: "Lab", iconEmoji: null, items: [file("x1", "Budget.xlsx")] },
];

// "tagged onboarding" — d1 and x1 carry it, nothing else does.
const tagged = new Set(["d1", "x1"]);
const byTag = (item: DriveItem) => tagged.has(item.id);

describe("searchAll", () => {
  it("returns nothing when there is neither a query nor a tag filter", () => {
    expect(searchAll(scopes, "", "all")).toEqual([]);
    expect(searchAll(scopes, "   ", "all")).toEqual([]);
  });

  it("matches on title across every scope", () => {
    expect(searchAll(scopes, "o", "all").map((h) => h.item.id).sort()).toEqual([
      "d1",
      "d2",
      "f1",
    ]);
  });

  it("treats a tag filter alone as a valid query", () => {
    expect(searchAll(scopes, "", "all", byTag).map((h) => h.item.id).sort()).toEqual([
      "d1",
      "x1",
    ]);
  });

  it("intersects a query with the tag filter rather than unioning them", () => {
    // "Budget.xlsx" is tagged but doesn't match the text, so it drops out.
    expect(searchAll(scopes, "handbook", "all", byTag).map((h) => h.item.id)).toEqual(["d1"]);
  });

  it("still honours the type filter alongside tags", () => {
    expect(searchAll(scopes, "", "file", byTag).map((h) => h.item.id)).toEqual(["x1"]);
    expect(searchAll(scopes, "", "doc", byTag).map((h) => h.item.id)).toEqual(["d1"]);
  });

  it("reports the scope-and-folder path of each hit", () => {
    const [hit] = searchAll(scopes, "handbook", "all");
    expect(hit.path).toBe("My Drive › Onboarding");
    expect(hit.scope.id).toBe("mine");
  });
});
