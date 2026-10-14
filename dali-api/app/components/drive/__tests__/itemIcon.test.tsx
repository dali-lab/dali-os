import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { itemIcon } from "~/components/drive/DriveBrowser";
import { RECEIVER_LABELS } from "~/lib/drive-receivers";
import type { DriveItem } from "~/lib/drive.server";

const at = new Date("2026-01-01T00:00:00Z");
const folder = (extra: Record<string, unknown> = {}) =>
  ({ type: "folder", id: "f", title: "F", parentFolderId: null, iconEmoji: null, updatedAt: at, href: "/x", ...extra }) as DriveItem;
const doc = (extra: Record<string, unknown> = {}) =>
  ({ type: "doc", id: "d", title: "D", parentFolderId: null, iconEmoji: null, updatedAt: at, href: "/x", ...extra }) as DriveItem;
const html = (item: DriveItem, size?: "sm" | "lg" | "xl") => renderToStaticMarkup(<>{itemIcon(item, size)}</>);

describe("itemIcon", () => {
  it("draws a notebook in coral with its tab count", () => {
    const out = html(doc({ isNotebook: true, tabCount: 3 }));
    expect(out).toContain("lucide-notebook-pen");
    expect(out).toContain("text-accent-coral");
    expect(out).toContain('data-testid="notebook-tab-count"');
    expect(out).toContain(">3<");
  });

  it("omits the badge on a notebook with no tabs", () => {
    expect(html(doc({ isNotebook: true, tabCount: 0 }))).not.toContain("notebook-tab-count");
  });

  const FOLDER_TYPES = ["Root", ...Object.keys(RECEIVER_LABELS)];

  it.each(FOLDER_TYPES)("draws a %s folder pink with the system icon", (folderType) => {
    const out = html(folder({ folderType, audience: { kind: "lab", label: "", permission: "View" } }));
    expect(out).toContain("lucide-folder-cog");
    expect(out).toContain("text-accent-pink");
    expect(out).not.toContain("text-accent-teal");
    expect(out).not.toContain("text-accent-coral");
  });

  it("overlays a pink calendar on a Meetings folder", () => {
    const out = html(folder({ folderType: "Meetings" }));
    expect(out).toContain("lucide-folder-cog");
    expect(out).toContain("lucide-calendar-days");
    expect(out).toContain("bg-background");
  });

  it("marks only Meetings folders with a calendar and never with a tag", () => {
    for (const folderType of FOLDER_TYPES.filter((t) => t !== "Meetings")) {
      const out = html(folder({ folderType }));
      expect(out).not.toContain("lucide-calendar-days");
      expect(out).not.toContain("lucide-tag");
    }
  });

  it("leaves a plain folder an unmarked folder icon", () => {
    const out = html(folder());
    expect(out).toContain("lucide-folder");
    expect(out).not.toContain("lucide-folder-cog");
    expect(out).not.toContain("text-accent-pink");
    expect(out).not.toContain("lucide-calendar-days");
  });

  it("tints a plain folder by audience", () => {
    expect(html(folder({ audience: { kind: "private", label: "", permission: "Edit" } }))).toContain("text-muted-foreground");
    expect(html(folder({ audience: { kind: "lab", label: "", permission: "View" } }))).toContain("text-accent-teal");
    expect(html(folder({ audience: { kind: "group", label: "", permission: "Edit" } }))).toContain("text-accent-coral");
  });

  it("shows a system folder's emoji instead of the icon", () => {
    const out = html(folder({ folderType: "Meetings", iconEmoji: "🗓" }));
    expect(out).toContain("🗓");
    expect(out).not.toContain("lucide-folder-cog");
  });

  it("keeps docs in the muted color", () => {
    const out = html(doc());
    expect(out).toContain("lucide-file-text");
    expect(out).toContain("text-muted-foreground");
  });

  it("scales the badge mark with the glyph", () => {
    expect(html(folder({ folderType: "Meetings" }), "sm")).toContain("w-2.5 h-2.5");
    expect(html(folder({ folderType: "Meetings" }), "xl")).toContain("w-3.5 h-3.5");
  });

  describe("shortcut", () => {
    const shortcut = (extra: Record<string, unknown> = {}) =>
      ({
        type: "shortcut",
        id: "s",
        title: "S",
        parentFolderId: null,
        iconEmoji: null,
        updatedAt: at,
        href: "/x",
        targetId: "t",
        targetType: "doc",
        canOpen: true,
        originalInTrash: false,
        ...extra,
      }) as DriveItem;

    it("draws the target's glyph with an arrow badge", () => {
      const out = html(shortcut());
      expect(out).toContain("lucide-file-text");
      expect(out).toContain("lucide-corner-down-right");
      expect(out).toContain("bg-background");
    });

    it("follows the target type", () => {
      expect(html(shortcut({ targetType: "folder" }))).toContain("lucide-folder");
      expect(html(shortcut({ targetType: "whiteboard" }))).toContain("lucide-shapes");
      expect(html(shortcut({ targetType: "notebook" }))).toContain("lucide-notebook-pen");
    });

    it("swaps the arrow for a lock when the viewer can't open the original", () => {
      const out = html(shortcut({ canOpen: false }));
      expect(out).toContain("lucide-lock");
      expect(out).not.toContain("lucide-corner-down-right");
    });

    it("scales the badge with the glyph", () => {
      expect(html(shortcut(), "sm")).toContain("w-2.5 h-2.5");
      expect(html(shortcut(), "xl")).toContain("w-3.5 h-3.5");
    });

    it("keeps the arrow when the original is in the trash", () => {
      const out = html(shortcut({ canOpen: false, originalInTrash: true }));
      expect(out).toContain("lucide-corner-down-right");
      expect(out).not.toContain("lucide-lock");
    });
  });
});
