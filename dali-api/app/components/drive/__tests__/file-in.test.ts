import { describe, expect, it } from "vitest";
import {
  bulkDeletedToast,
  canFileIn,
  destinationForPlace,
  folderShortcutTarget,
  locateTarget,
  placeLabel,
  placeToast,
  planPlacement,
  shortcutRowState,
  shortcutToast,
  toServerDest,
  SHORTCUT_REMOVED_TOAST,
  type PagePlace,
} from "~/components/drive/file-in";
import type { Destination } from "~/components/drive/FolderPicker";
import type { PickerRows } from "~/components/drive/picker-rows";
import type { DriveItem } from "~/lib/drive.server";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";

const rows: PickerRows = {
  drives: [
    { id: "lab", label: "Lab" },
    { id: "core", label: "Core", rootFolderId: "core-root" },
    { id: "projects", label: "Projects" },
    { id: "education", label: "Education" },
  ],
  folders: [
    { id: "lab-a", driveId: "lab", parentId: null, title: "A" },
    { id: "core-m", driveId: "core", parentId: null, title: "Meetings" },
    { id: "p1", driveId: "projects", parentId: null, title: "Atlas" },
    { id: "p1-docs", driveId: "projects", parentId: "p1", title: "Docs" },
    { id: "o1", driveId: "education", parentId: null, title: "Intro" },
  ],
};

const place = (over: Partial<PagePlace> = {}): PagePlace => ({
  workspaceType: "Lab",
  workspaceId: null,
  folderId: null,
  path: [],
  ...over,
});

const at = new Date("2026-01-01T00:00:00Z");
const item = (type: string, extra: Record<string, unknown> = {}) =>
  ({ type, id: "i", title: "T", parentFolderId: "f", iconEmoji: null, updatedAt: at, href: "/x", ...extra }) as DriveItem;

describe("canFileIn", () => {
  it("allows docs, notebooks and folders", () => {
    expect(canFileIn(item("doc"), "lab", [])).toBe(true);
    expect(canFileIn(item("doc", { isNotebook: true }), "lab", [])).toBe(true);
    expect(canFileIn(item("folder"), "lab", [])).toBe(true);
  });

  it("refuses everything else", () => {
    for (const type of ["file", "form", "agreement", "rubric", "shortcut"]) {
      expect(canFileIn(item(type), "lab", [])).toBe(false);
    }
  });

  it("refuses My Drive", () => {
    expect(canFileIn(item("doc"), "mine", [])).toBe(false);
  });

  it("refuses the folder that stands in for a project or an offering", () => {
    const top = item("folder", { id: "p1", parentFolderId: null });
    expect(canFileIn(top, "projects", [top])).toBe(false);
    expect(canFileIn(top, "education", [top])).toBe(false);
    const real = item("folder", { id: "p1-docs", parentFolderId: "p1" });
    expect(canFileIn(real, "projects", [top, real])).toBe(true);
    expect(canFileIn(top, "lab", [top])).toBe(true);
  });
});

describe("destinationForPlace", () => {
  it("maps a folder to its drive", () => {
    expect(destinationForPlace(place({ folderId: "lab-a" }), rows)).toEqual({ driveId: "lab", folderId: "lab-a" });
    expect(destinationForPlace(place({ workspaceType: "Project", workspaceId: "p1", folderId: "p1-docs" }), rows)).toEqual({
      driveId: "projects",
      folderId: "p1-docs",
    });
  });

  it("maps a process root to that drive's top level", () => {
    expect(destinationForPlace(place({ folderId: "core-root" }), rows)).toEqual({ driveId: "core", folderId: null });
  });

  it("maps a workspace's top level", () => {
    expect(destinationForPlace(place(), rows)).toEqual({ driveId: "lab", folderId: null });
    expect(destinationForPlace(place({ workspaceType: "Project", workspaceId: "p1" }), rows)).toEqual({
      driveId: "projects",
      folderId: "p1",
    });
    expect(destinationForPlace(place({ workspaceType: "EducationOffering", workspaceId: "o1" }), rows)).toEqual({
      driveId: "education",
      folderId: "o1",
    });
  });

  it("is null for what the picker doesn't offer", () => {
    expect(destinationForPlace(place({ folderId: "unknown" }), rows)).toBeNull();
    expect(destinationForPlace(place({ workspaceType: "Member", workspaceId: "u" }), rows)).toBeNull();
    expect(destinationForPlace(place({ workspaceType: "Project", workspaceId: "gone" }), rows)).toBeNull();
  });
});

describe("toServerDest", () => {
  it("is the workspace and parent the shortcut endpoints take", () => {
    expect(toServerDest({ driveId: "projects", folderId: "p1-docs" }, rows)).toEqual({
      workspaceType: "Project",
      workspaceId: "p1",
      parentPageId: "p1-docs",
    });
    expect(toServerDest({ driveId: "core", folderId: null }, rows)).toEqual({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "core-root",
    });
  });

  it("is null for a bare Projects list", () => {
    expect(toServerDest({ driveId: "projects", folderId: null }, rows)).toBeNull();
  });
});

describe("planPlacement", () => {
  const lab: Destination = { driveId: "lab", folderId: "lab-a" };
  const core: Destination = { driveId: "core", folderId: "core-m" };
  const docs: Destination = { driveId: "projects", folderId: "p1-docs" };

  it("sends the primary and each new location, and counts the shortcuts it adds", () => {
    const plan = planPlacement({
      result: { destinations: [lab, core, docs], primaryIndex: 0 },
      rows,
      currentPrimary: lab,
      locked: [],
    });
    expect(plan.primaryChanged).toBe(false);
    expect(plan.added).toBe(2);
    expect(plan.payload).toEqual({
      destinations: [
        { workspaceType: "Lab", workspaceId: null, parentPageId: "lab-a" },
        { workspaceType: "Lab", workspaceId: null, parentPageId: "core-m" },
        { workspaceType: "Project", workspaceId: "p1", parentPageId: "p1-docs" },
      ],
      primaryIndex: 0,
    });
  });

  it("leaves locked shortcuts out of the request and re-indexes the primary", () => {
    const plan = planPlacement({
      result: { destinations: [core, lab, docs], primaryIndex: 2 },
      rows,
      currentPrimary: lab,
      locked: [core],
    });
    expect(plan.primaryChanged).toBe(true);
    expect(plan.added).toBe(1);
    expect(plan.payload?.destinations).toHaveLength(2);
    expect(plan.payload?.primaryIndex).toBe(1);
    expect(plan.payload?.destinations[1].parentPageId).toBe("p1-docs");
  });

  it("changes nothing when the current location is primary and nothing is new", () => {
    const plan = planPlacement({
      result: { destinations: [lab, core], primaryIndex: 0 },
      rows,
      currentPrimary: lab,
      locked: [core],
    });
    expect(plan).toMatchObject({ primaryChanged: false, added: 0 });
  });

  it("has no payload when a chosen destination can't be filed into", () => {
    const plan = planPlacement({
      result: { destinations: [lab, { driveId: "projects", folderId: null }], primaryIndex: 0 },
      rows,
      currentPrimary: lab,
      locked: [],
    });
    expect(plan.payload).toBeNull();
  });
});

describe("toasts", () => {
  it("names what was added, the primary, and how many grants were declined", () => {
    expect(placeToast({ added: 2, declined: 1, primaryPath: "Lab / A" })).toBe(
      "2 locations added. Primary: Lab / A. 1 could not be shared; ask the owner.",
    );
  });

  it("is singular for one and drops the lines that don't apply", () => {
    expect(placeToast({ added: 1, declined: 0, primaryPath: "Lab / A" })).toBe("1 location added. Primary: Lab / A.");
    expect(placeToast({ added: 0, declined: 0, primaryPath: "Lab / A" })).toBe("Primary: Lab / A.");
  });

  it("reports a single shortcut", () => {
    expect(shortcutToast({ created: true, grantDeclined: false, folderLabel: "Lab / A" })).toBe("Shortcut added to Lab / A.");
    expect(shortcutToast({ created: true, grantDeclined: true, folderLabel: "Lab / A" })).toBe(
      "Shortcut added to Lab / A. It could not be shared; ask the owner.",
    );
    expect(shortcutToast({ created: false, grantDeclined: false, folderLabel: "Lab / A" })).toBe(
      "There is already a shortcut in Lab / A.",
    );
  });

  it("says the original is untouched when a shortcut is removed", () => {
    expect(SHORTCUT_REMOVED_TOAST).toBe("Shortcut removed. The original is untouched.");
  });
});

describe("bulkDeletedToast", () => {
  it("says the originals are untouched when only shortcuts went", () => {
    expect(bulkDeletedToast([{ type: "shortcut" }, { type: "shortcut" }])).toBe("2 shortcuts removed. The originals are untouched.");
    expect(bulkDeletedToast([{ type: "shortcut" }])).toBe(SHORTCUT_REMOVED_TOAST);
  });

  it("counts a mixed selection plainly", () => {
    expect(bulkDeletedToast([{ type: "shortcut" }, { type: "doc" }])).toBe("Deleted 2");
    expect(bulkDeletedToast([{ type: "doc" }])).toBe("Deleted 1");
  });
});

describe("placeLabel", () => {
  it("joins the folder path", () => {
    expect(placeLabel(place({ path: [{ id: "a", title: "Core" }, { id: "b", title: "Check-ins" }] }))).toBe("Core / Check-ins");
  });

  it("names the workspace for a top-level place", () => {
    expect(placeLabel(place())).toBe("Lab");
    expect(placeLabel(place({ workspaceType: "Project", workspaceId: "p" }))).toBe("Project");
  });

  it("titles an unnamed folder", () => {
    expect(placeLabel(place({ path: [{ id: "a", title: "" }] }))).toBe("Untitled folder");
  });
});

describe("shortcutRowState", () => {
  const shortcut = (extra: Record<string, unknown>) =>
    item("shortcut", { targetId: "t", targetType: "doc", canOpen: true, originalInTrash: false, ...extra });

  it("leaves other items and openable shortcuts alone", () => {
    expect(shortcutRowState(item("doc"))).toEqual({ dimmed: false, inTrash: false });
    expect(shortcutRowState(shortcut({}))).toEqual({ dimmed: false, inTrash: false });
  });

  it("dims a shortcut the viewer can't open", () => {
    expect(shortcutRowState(shortcut({ canOpen: false }))).toEqual({ dimmed: true, inTrash: false });
  });

  it("flags a trashed original", () => {
    expect(shortcutRowState(shortcut({ canOpen: false, originalInTrash: true }))).toEqual({ dimmed: true, inTrash: true });
  });
});

describe("locateTarget", () => {
  const scopes = [
    {
      id: "lab",
      label: "Lab",
      iconEmoji: null,
      items: [
        item("folder", { id: "f1", title: "Meetings", parentFolderId: null }),
        item("doc", { id: "d1", title: "Notes", parentFolderId: "f1" }),
      ],
    },
  ] as DriveTreeScope[];

  it("finds the original's folder among the loaded scopes", () => {
    expect(locateTarget(scopes, "d1")).toMatchObject({ scopeId: "lab", folderId: "f1", path: "Lab › Meetings" });
  });

  it("is null when the original isn't loaded", () => {
    expect(locateTarget(scopes, "elsewhere")).toBeNull();
  });
});

describe("folderShortcutTarget", () => {
  const scopes = [
    { id: "lab", label: "Lab", iconEmoji: null, items: [item("folder", { id: "f1", parentFolderId: null })] },
  ] as DriveTreeScope[];
  const shortcut = (extra: Record<string, unknown>) =>
    item("shortcut", { targetId: "f1", targetType: "folder", canOpen: true, originalInTrash: false, ...extra });

  it("opens a shortcut to a folder in the Drive, in the scope that holds the folder", () => {
    expect(folderShortcutTarget(scopes, shortcut({}))).toEqual({ scopeId: "lab", folderId: "f1" });
  });

  it("leaves shortcuts to pages, locked shortcuts and folders outside the loaded scopes to the host", () => {
    expect(folderShortcutTarget(scopes, shortcut({ targetType: "doc" }))).toBeNull();
    expect(folderShortcutTarget(scopes, shortcut({ canOpen: false }))).toBeNull();
    expect(folderShortcutTarget(scopes, shortcut({ targetId: "elsewhere" }))).toBeNull();
    expect(folderShortcutTarget(scopes, item("folder"))).toBeNull();
  });
});
