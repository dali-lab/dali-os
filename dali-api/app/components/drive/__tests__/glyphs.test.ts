import { describe, expect, it } from "vitest";
import {
  CORAL_FOLDER,
  folderCountLabel,
  folderTintClass,
  pickGlyph,
  tabBadge,
  type PlainGlyphSource,
  type ShortcutGlyphSource,
} from "~/components/drive/glyphs";
import type { AudienceKind } from "~/lib/page-audience";

describe("folderTintClass", () => {
  const tint = (kind: AudienceKind) => folderTintClass({ kind });

  it("mutes a private folder", () => {
    expect(tint("private")).toBe("text-muted-foreground");
  });

  it("keeps coral for group, people and project folders", () => {
    expect(tint("group")).toBe(CORAL_FOLDER);
    expect(tint("people")).toBe(CORAL_FOLDER);
    expect(tint("project")).toBe(CORAL_FOLDER);
  });

  it("uses teal for lab-wide and public folders", () => {
    expect(tint("lab")).toBe("text-accent-teal/80");
    expect(tint("public")).toBe("text-accent-teal/80");
  });

  it("falls back to coral when the folder has no audience", () => {
    expect(folderTintClass(undefined)).toBe(CORAL_FOLDER);
    expect(folderTintClass(null)).toBe(CORAL_FOLDER);
  });
});

describe("pickGlyph", () => {
  const folder = (extra: Partial<PlainGlyphSource> = {}): PlainGlyphSource => ({ type: "folder", ...extra });
  const doc = (extra: Partial<PlainGlyphSource> = {}): PlainGlyphSource => ({ type: "doc", ...extra });

  it("marks a Meetings folder with a calendar", () => {
    expect(pickGlyph(folder({ folderType: "Meetings" }))).toMatchObject({ kind: "folder", mark: "calendar" });
  });

  it("marks every other receiver folder with a tag", () => {
    for (const folderType of ["Agreements", "Hiring", "Receipts"]) {
      expect(pickGlyph(folder({ folderType }))).toMatchObject({ kind: "folder", mark: "tag" });
    }
  });

  it("leaves a plain folder, and a Root, unmarked", () => {
    expect(pickGlyph(folder())).toMatchObject({ kind: "folder", mark: null });
    expect(pickGlyph(folder({ folderType: null }))).toMatchObject({ kind: "folder", mark: null });
    expect(pickGlyph(folder({ folderType: "Root" }))).toMatchObject({ kind: "folder", mark: null });
  });

  it("tints a folder by its audience", () => {
    expect(pickGlyph(folder({ audience: { kind: "private" } }))).toMatchObject({ tint: "text-muted-foreground" });
    expect(pickGlyph(folder({ audience: { kind: "public" } }))).toMatchObject({ tint: "text-accent-teal/80" });
  });

  it("gives a folder or doc its emoji when it has one", () => {
    expect(pickGlyph(folder({ iconEmoji: "🚀" }))).toEqual({ kind: "emoji", emoji: "🚀" });
    expect(pickGlyph(doc({ iconEmoji: "📝" }))).toEqual({ kind: "emoji", emoji: "📝" });
  });

  it("picks the notebook glyph with its tab badge, ahead of an emoji", () => {
    expect(pickGlyph(doc({ isNotebook: true, tabCount: 4, iconEmoji: "📓" }))).toEqual({ kind: "notebook", tabs: "4" });
    expect(pickGlyph(doc({ isNotebook: true, tabCount: 0 }))).toEqual({ kind: "notebook", tabs: null });
    expect(pickGlyph(doc({ isNotebook: true }))).toEqual({ kind: "notebook", tabs: null });
  });

  describe("shortcut", () => {
    const shortcut = (extra: Partial<ShortcutGlyphSource> = {}): ShortcutGlyphSource => ({
      type: "shortcut",
      targetType: "doc",
      canOpen: true,
      originalInTrash: false,
      ...extra,
    });

    it("wears the glyph of what it points at", () => {
      expect(pickGlyph(shortcut({ targetType: "doc" }))).toEqual({ kind: "shortcut", target: { kind: "doc" }, locked: false });
      expect(pickGlyph(shortcut({ targetType: "whiteboard" }))).toMatchObject({ target: { kind: "whiteboard" } });
      expect(pickGlyph(shortcut({ targetType: "notebook" }))).toMatchObject({ target: { kind: "notebook", tabs: null } });
      expect(pickGlyph(shortcut({ targetType: "folder" }))).toMatchObject({
        target: { kind: "folder", tint: CORAL_FOLDER, mark: null },
      });
    });

    it("does not tint a folder shortcut by the audience of the folder it sits in", () => {
      expect(pickGlyph({ ...shortcut({ targetType: "folder" }), audience: { kind: "private" } } as ShortcutGlyphSource)).toMatchObject({
        target: { tint: CORAL_FOLDER },
      });
    });

    it("locks a shortcut the viewer can't open, but not one whose original is in the trash", () => {
      expect(pickGlyph(shortcut({ canOpen: false }))).toMatchObject({ locked: true });
      expect(pickGlyph(shortcut({ canOpen: false, originalInTrash: true }))).toMatchObject({ locked: false });
    });
  });

  it("keeps the existing doc, whiteboard and managed glyphs", () => {
    expect(pickGlyph(doc())).toEqual({ kind: "doc" });
    expect(pickGlyph(doc({ isWhiteboard: true }))).toEqual({ kind: "whiteboard" });
    for (const type of ["file", "form", "agreement", "rubric"] as const) {
      expect(pickGlyph({ type })).toEqual({ kind: type });
    }
  });
});

describe("tabBadge", () => {
  it("shows nothing for no tabs", () => {
    expect(tabBadge(undefined)).toBeNull();
    expect(tabBadge(0)).toBeNull();
  });

  it("shows the count, capped at 99+", () => {
    expect(tabBadge(1)).toBe("1");
    expect(tabBadge(99)).toBe("99");
    expect(tabBadge(100)).toBe("99+");
  });
});

describe("folderCountLabel", () => {
  it("says nothing until counts are known", () => {
    expect(folderCountLabel(undefined)).toBeNull();
  });

  it("says Empty, singular and plural", () => {
    expect(folderCountLabel(0)).toBe("Empty");
    expect(folderCountLabel(1)).toBe("1 item");
    expect(folderCountLabel(12)).toBe("12 items");
  });
});
