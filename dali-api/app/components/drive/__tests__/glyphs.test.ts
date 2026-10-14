import { describe, expect, it } from "vitest";
import {
  CORAL_FOLDER,
  PINK_FOLDER,
  folderCountLabel,
  folderTintClass,
  glyphLabel,
  pickGlyph,
  tabBadge,
  type GlyphSource,
} from "~/components/drive/glyphs";
import { RECEIVER_LABELS } from "~/lib/drive-receivers";
import type { AudienceKind } from "~/lib/page-audience";

const FOLDER_TYPES = ["Root", ...Object.keys(RECEIVER_LABELS)];

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
  const folder = (extra: Partial<GlyphSource> = {}): GlyphSource => ({ type: "folder", ...extra });
  const doc = (extra: Partial<GlyphSource> = {}): GlyphSource => ({ type: "doc", ...extra });

  it("marks a Meetings folder with a calendar", () => {
    expect(pickGlyph(folder({ folderType: "Meetings" }))).toMatchObject({ kind: "folder", mark: "calendar" });
  });

  it.each(FOLDER_TYPES)("draws a %s folder as a pink system folder", (folderType) => {
    expect(pickGlyph(folder({ folderType }))).toMatchObject({ kind: "folder", tint: PINK_FOLDER, system: true, folderType });
  });

  it("keeps the calendar mark for Meetings only", () => {
    for (const folderType of FOLDER_TYPES.filter((t) => t !== "Meetings")) {
      expect(pickGlyph(folder({ folderType }))).toMatchObject({ mark: null });
    }
  });

  it("leaves a plain folder a non-system folder with no mark", () => {
    expect(pickGlyph(folder())).toMatchObject({ kind: "folder", mark: null, system: false, folderType: null });
    expect(pickGlyph(folder({ folderType: null }))).toMatchObject({ mark: null, system: false });
  });

  it("paints a system folder pink whatever its audience", () => {
    for (const kind of ["private", "lab", "group"] as const) {
      expect(pickGlyph(folder({ folderType: "Agreements", audience: { kind } }))).toMatchObject({ tint: PINK_FOLDER });
    }
  });

  it("tints a folder by its audience", () => {
    expect(pickGlyph(folder({ audience: { kind: "private" } }))).toMatchObject({ tint: "text-muted-foreground" });
    expect(pickGlyph(folder({ audience: { kind: "public" } }))).toMatchObject({ tint: "text-accent-teal/80" });
  });

  it("keeps the emoji of a system folder", () => {
    expect(pickGlyph(folder({ folderType: "Meetings", iconEmoji: "🗓" }))).toEqual({ kind: "emoji", emoji: "🗓" });
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
  const label = (src: GlyphSource, ctx: Parameters<typeof glyphLabel>[1] = {}) =>
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

  it.each([
    ["HiringForms", "Hiring forms folder"],
    ["ApplicationTemplates", "Application templates folder"],
    ["Agreements", "Agreements folder"],
    ["EducationTemplates", "Education templates folder"],
    ["CertificateBackgrounds", "Certificate backgrounds folder"],
    ["MentorNotebooks", "Mentor notebooks folder"],
  ])("names a %s folder by what it receives", (folderType, expected) => {
    expect(label({ type: "folder", folderType })).toBe(expected);
    expect(label({ type: "folder", folderType }, { audienceLabel: "Only you" })).toBe(`${expected} · Only you`);
  });

  it("names a Root folder as a drive", () => {
    expect(label({ type: "folder", folderType: "Root" }, { title: "Core" })).toBe("Core drive");
    expect(label({ type: "folder", folderType: "Root" })).toBe("Drive");
  });

  it("names an unknown folder type a plain Folder", () => {
    expect(label({ type: "folder", folderType: "Receipts" })).toBe("Folder");
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
});
