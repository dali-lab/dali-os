import { describe, expect, it } from "vitest";
import {
  CORAL_FOLDER,
  folderCountLabel,
  folderTintClass,
  glyphLabel,
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

describe("glyphLabel", () => {
  const label = (src: PlainGlyphSource | ShortcutGlyphSource, ctx: Parameters<typeof glyphLabel>[1] = {}) =>
    glyphLabel(pickGlyph(src), ctx);

  it("names a folder with who can see it", () => {
    expect(label({ type: "folder" }, { audienceLabel: "Everyone in the lab" })).toBe("Folder · Everyone in the lab");
    expect(label({ type: "folder" }, { audienceLabel: "Only you" })).toBe("Folder · Only you");
    expect(label({ type: "folder" }, { audienceLabel: "Project team · lab can view" })).toBe(
      "Folder · Project team · lab can view",
    );
  });

  it("names a folder with no audience on its own", () => {
    expect(label({ type: "folder" })).toBe("Folder");
    expect(label({ type: "folder" }, { audienceLabel: null })).toBe("Folder");
    expect(label({ type: "folder" }, { audienceLabel: "" })).toBe("Folder");
  });

  it("calls a calendar-marked folder a Meetings folder", () => {
    expect(label({ type: "folder", folderType: "Meetings" }, { audienceLabel: "Everyone in the lab" })).toBe(
      "Meetings folder · new notebooks file here · Everyone in the lab",
    );
    expect(label({ type: "folder", folderType: "Meetings" })).toBe("Meetings folder · new notebooks file here");
  });

  it("keeps a tag-marked or Root folder a plain Folder", () => {
    expect(label({ type: "folder", folderType: "Hiring" })).toBe("Folder");
    expect(label({ type: "folder", folderType: "Root" })).toBe("Folder");
  });

  it("counts a notebook's tabs", () => {
    expect(label({ type: "doc", isNotebook: true }, { tabCount: 3 })).toBe("Notebook · 3 tabs");
    expect(label({ type: "doc", isNotebook: true }, { tabCount: 1 })).toBe("Notebook · 1 tab");
    expect(label({ type: "doc", isNotebook: true }, { tabCount: 0 })).toBe("Notebook · no tabs");
    expect(label({ type: "doc", isNotebook: true })).toBe("Notebook · no tabs");
  });

  it("does not put an audience on a notebook", () => {
    expect(label({ type: "doc", isNotebook: true }, { tabCount: 2, audienceLabel: "Only you" })).toBe("Notebook · 2 tabs");
  });

  it("names the plain kinds", () => {
    expect(label({ type: "doc" })).toBe("Document");
    expect(label({ type: "doc", isWhiteboard: true })).toBe("Whiteboard");
    expect(label({ type: "file" })).toBe("File");
    expect(label({ type: "form" })).toBe("Form");
    expect(label({ type: "agreement" })).toBe("Agreement");
    expect(label({ type: "rubric" })).toBe("Rubric");
  });

  it("names a custom-icon folder or doc by its type", () => {
    expect(label({ type: "folder", iconEmoji: "🚀" }, { itemType: "folder", audienceLabel: "Only you" })).toBe(
      "Folder · Only you",
    );
    expect(label({ type: "doc", iconEmoji: "📝" }, { itemType: "doc" })).toBe("Document");
    expect(label({ type: "doc", iconEmoji: "📝" })).toBe("Document");
  });

  it.each([
    ["doc", "Shortcut to a document"],
    ["folder", "Shortcut to a folder"],
    ["notebook", "Shortcut to a notebook"],
    ["whiteboard", "Shortcut to a whiteboard"],
  ] as const)("names a shortcut to a %s", (targetType, expected) => {
    expect(label({ type: "shortcut", targetType, canOpen: true })).toBe(expected);
  });

  it("flags a shortcut whose original is in the trash", () => {
    expect(
      label({ type: "shortcut", targetType: "doc", canOpen: false, originalInTrash: true }, { originalInTrash: true }),
    ).toBe("Shortcut to a document · original in trash");
  });

  it("flags a shortcut whose original the viewer can't open", () => {
    expect(label({ type: "shortcut", targetType: "folder", canOpen: false })).toBe(
      "Shortcut to a folder · you can't open the original",
    );
  });

  it("does not use the audience for a shortcut", () => {
    expect(label({ type: "shortcut", targetType: "doc", canOpen: true }, { audienceLabel: "Only you" })).toBe(
      "Shortcut to a document",
    );
  });
});
