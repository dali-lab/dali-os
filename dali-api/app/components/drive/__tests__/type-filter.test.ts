import { describe, expect, it } from "vitest";
import { DRIVE_TYPE_FILTERS, listedUnderFilter, matchesTypeFilter, parseTypeFilter } from "~/components/drive/type-filter";
import type { DriveItem } from "~/lib/drive.server";

const at = new Date("2026-01-01T00:00:00Z");
const base = { parentFolderId: null, iconEmoji: null, updatedAt: at, href: "/x" };
const doc = { type: "doc", id: "d", title: "Doc", ...base } as DriveItem;
const notebook = { type: "doc", id: "n", title: "Notebook", isNotebook: true, ...base } as DriveItem;
const whiteboard = { type: "doc", id: "w", title: "Board", isWhiteboard: true, ...base } as DriveItem;
const slides = { type: "doc", id: "s", title: "Deck", isSlides: true, ...base } as DriveItem;
const file = { type: "file", id: "f", title: "File", ...base } as DriveItem;
const folder = { type: "folder", id: "fo", title: "Folder", ...base } as DriveItem;
const form = { type: "form", id: "fm", title: "Form", ...base } as DriveItem;

describe("matchesTypeFilter", () => {
  it("matches everything under all", () => {
    for (const item of [doc, notebook, whiteboard, slides, file, folder, form]) expect(matchesTypeFilter(item, "all")).toBe(true);
  });

  it("keeps Documents to plain docs", () => {
    expect(matchesTypeFilter(doc, "doc")).toBe(true);
    expect(matchesTypeFilter(notebook, "doc")).toBe(false);
    expect(matchesTypeFilter(whiteboard, "doc")).toBe(false);
    expect(matchesTypeFilter(slides, "doc")).toBe(false);
    expect(matchesTypeFilter(file, "doc")).toBe(false);
  });

  it("gives notebooks and whiteboards their own filters", () => {
    expect(matchesTypeFilter(notebook, "notebook")).toBe(true);
    expect(matchesTypeFilter(doc, "notebook")).toBe(false);
    expect(matchesTypeFilter(whiteboard, "notebook")).toBe(false);
    expect(matchesTypeFilter(whiteboard, "whiteboard")).toBe(true);
    expect(matchesTypeFilter(doc, "whiteboard")).toBe(false);
    expect(matchesTypeFilter(notebook, "whiteboard")).toBe(false);
  });

  it("gives slide decks their own filter", () => {
    expect(matchesTypeFilter(slides, "slides")).toBe(true);
    expect(matchesTypeFilter(slides, "whiteboard")).toBe(false);
    expect(matchesTypeFilter(whiteboard, "slides")).toBe(false);
    expect(matchesTypeFilter(doc, "slides")).toBe(false);
  });

  it("matches other types by their type", () => {
    expect(matchesTypeFilter(file, "file")).toBe(true);
    expect(matchesTypeFilter(form, "form")).toBe(true);
    expect(matchesTypeFilter(form, "file")).toBe(false);
    expect(matchesTypeFilter(folder, "file")).toBe(false);
  });
});

describe("listedUnderFilter", () => {
  it("keeps folders under every filter", () => {
    for (const f of DRIVE_TYPE_FILTERS) expect(listedUnderFilter(folder, f)).toBe(true);
  });

  it("otherwise follows the type match", () => {
    expect(listedUnderFilter(notebook, "notebook")).toBe(true);
    expect(listedUnderFilter(doc, "notebook")).toBe(false);
  });
});

describe("parseTypeFilter", () => {
  it("accepts every known filter from the URL", () => {
    for (const f of DRIVE_TYPE_FILTERS) expect(parseTypeFilter(f)).toBe(f);
  });

  it("falls back to all for anything else", () => {
    expect(parseTypeFilter(null)).toBe("all");
    expect(parseTypeFilter(undefined)).toBe("all");
    expect(parseTypeFilter("")).toBe("all");
    expect(parseTypeFilter("notebooks")).toBe("all");
  });
});
