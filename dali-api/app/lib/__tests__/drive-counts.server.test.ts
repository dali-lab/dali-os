import { describe, expect, it } from "vitest";
import { withChildCounts } from "~/lib/drive-counts.server";
import type { DriveItem } from "~/lib/drive.server";

const at = new Date("2026-01-01T00:00:00Z");
const base = { iconEmoji: null, updatedAt: at, href: "/x" };

const folder = (id: string, parentFolderId: string | null = null): DriveItem => ({
  type: "folder", id, title: id, parentFolderId, ...base,
});
const doc = (id: string, parentFolderId: string | null, extra: Record<string, unknown> = {}): DriveItem =>
  ({ type: "doc", id, title: id, parentFolderId, ...base, ...extra }) as DriveItem;
const file = (id: string, parentFolderId: string | null): DriveItem => ({
  type: "file", id, title: id, parentFolderId, ...base, iconEmoji: null,
});
const form = (id: string, parentFolderId: string | null): DriveItem => ({
  type: "form", id, title: id, parentFolderId, ...base, iconEmoji: null,
});

const byId = (items: DriveItem[], id: string) => items.find((i) => i.id === id)!;

describe("withChildCounts", () => {
  it("counts pages, folders, files and forms directly inside a folder", () => {
    const out = withChildCounts([
      folder("f"), doc("d", "f"), folder("sub", "f"), file("x", "f"), form("q", "f"), doc("top", null),
    ]);
    expect(byId(out, "f")).toMatchObject({ itemCount: 4 });
  });

  it("counts only direct children, not descendants", () => {
    const out = withChildCounts([folder("f"), folder("sub", "f"), doc("deep", "sub")]);
    expect(byId(out, "f")).toMatchObject({ itemCount: 1 });
    expect(byId(out, "sub")).toMatchObject({ itemCount: 1 });
  });

  it("gives an empty folder a count of zero", () => {
    expect(byId(withChildCounts([folder("f")]), "f")).toMatchObject({ itemCount: 0 });
  });

  it("counts a notebook's tabs", () => {
    const out = withChildCounts([doc("nb", null, { isNotebook: true }), doc("t1", "nb"), doc("t2", "nb")]);
    expect(byId(out, "nb")).toMatchObject({ tabCount: 2 });
  });

  it("gives a notebook with no tabs a count of zero", () => {
    expect(byId(withChildCounts([doc("nb", null, { isNotebook: true })]), "nb")).toMatchObject({ tabCount: 0 });
  });

  it("leaves plain docs, files and forms untouched", () => {
    const items = [doc("d", null), file("x", null), form("q", null)];
    const out = withChildCounts(items);
    expect(out).toEqual(items);
    expect(byId(out, "d")).not.toHaveProperty("tabCount");
  });

  it("does not mutate its input", () => {
    const f = folder("f");
    withChildCounts([f, doc("d", "f")]);
    expect(f).not.toHaveProperty("itemCount");
  });
});
