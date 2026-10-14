import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FolderPicker,
  RECENT_DEST_KEY,
  buildBrowseRows,
  destinationPath,
  existingRecents,
  folderGlyph,
  folderNote,
  isPreferred,
  preferFirst,
  readRecentDestinations,
  rememberDestination,
  writeRecentDestination,
  indexFoldersByParent,
  type Destination,
  type PickerDrive,
  type PickerFolder,
} from "~/components/drive/FolderPicker";

// Browsing the picker used to be a flat list of bare folder names. The Lab
// drive has two folders literally called "Meeting notes" (one Core-scoped, one
// not), so the name alone could not tell you which one you wanted, and nothing
// said which drive would change who can see the item.

const drives: PickerDrive[] = [
  { id: "lab", label: "Lab", audience: "Everyone in the lab" },
  { id: "core", label: "Core", audience: "Core only" },
];

const folders: PickerFolder[] = [
  { id: "f1", driveId: "lab", parentId: null, title: "Operations", itemCount: 3 },
  { id: "f2", driveId: "lab", parentId: null, title: "Resources", itemCount: 0 },
  { id: "f3", driveId: "core", parentId: null, title: "Agreements", itemCount: 1 },
];

describe("folderNote", () => {
  it("counts what's inside", () => {
    expect(folderNote(3, null)).toBe("3 items");
    expect(folderNote(1, null)).toBe("1 item");
    expect(folderNote(0, null)).toBe("Empty");
  });

  it("says nothing when the caller can't count", () => {
    expect(folderNote(undefined, null)).toBeNull();
  });

  it("prefers the reason a row is disabled over its contents", () => {
    // A dimmed row with no explanation reads as a bug, and "3 items" doesn't
    // tell you why you can't click it.
    expect(folderNote(3, "Current location")).toBe("Current location");
    expect(folderNote(undefined, "Can't move a folder into itself")).toBe(
      "Can't move a folder into itself",
    );
  });
});

describe("FolderPicker drive list", () => {
  it("labels each drive with who can see it", () => {
    // Which drive you pick is the part of a move that changes the audience.
    const html = renderToStaticMarkup(
      createElement(FolderPicker, {
        open: true,
        onClose: () => {},
        heading: "Move “Kickoff notes”",
        drives,
        folders,
        onConfirm: () => {},
      }),
    );
    expect(html).toContain("Everyone in the lab");
    expect(html).toContain("Core only");
  });
});

describe("buildBrowseRows", () => {
  const never = () => false;
  const noReason = () => null;

  function rowsIn(
    folderId: string | null,
    over: {
      folders?: PickerFolder[];
      isDisabled?: (d: Destination) => boolean;
      disabledReason?: (d: Destination) => string | null;
    } = {},
  ) {
    const list = over.folders ?? folders;
    return buildBrowseRows({
      cwd: { driveId: "lab", folderId },
      drives,
      folders: list,
      childrenByParent: indexFoldersByParent(list),
      isDisabled: over.isDisabled ?? never,
      disabledReason: over.disabledReason ?? noReason,
    });
  }

  it("says what's inside each folder", () => {
    const notes = rowsIn(null)
      .filter((r) => r.kind === "folder")
      .map((r) => [r.label, "note" in r ? r.note : null]);
    expect(notes).toEqual([
      ["Operations", "3 items"],
      ["Resources", "Empty"],
    ]);
  });

  it("drops the subtitle when the caller supplies no count", () => {
    const rows = rowsIn(null, {
      folders: [{ id: "f1", driveId: "lab", parentId: null, title: "Operations" }],
    });
    const folder = rows.find((r) => r.kind === "folder")!;
    expect(folder.label).toBe("Operations");
    expect("note" in folder ? folder.note : undefined).toBeNull();
  });

  it("explains why a row can't be picked instead of leaving it bare", () => {
    const rows = rowsIn(null, {
      isDisabled: (d) => d.folderId === "f1",
      disabledReason: (d) => (d.folderId === "f1" ? "Current location" : null),
    });
    const folder = rows.find((r) => r.kind === "folder" && r.label === "Operations");
    expect(folder?.kind).toBe("folder");
    expect(folder && "disabled" in folder ? folder.disabled : undefined).toBe(true);
    expect(folder && "note" in folder ? folder.note : undefined).toBe("Current location");
  });

  it("leads with a row that drops the item where you already are", () => {
    expect(rowsIn(null)[0]).toMatchObject({ kind: "container", label: "Top level of Lab" });
    expect(rowsIn("f1")[0]).toMatchObject({ kind: "container", label: 'Move into "Operations"' });
  });

  it("lists only the current folder's children", () => {
    const nested: PickerFolder[] = [
      ...folders,
      { id: "f4", driveId: "lab", parentId: "f1", title: "26F", itemCount: 2 },
    ];
    expect(rowsIn("f1", { folders: nested }).filter((r) => r.kind === "folder").map((r) => r.label)).toEqual(["26F"]);
  });

  it("only offers the drive list at the top level", () => {
    const rows = buildBrowseRows({
      cwd: { driveId: null, folderId: null },
      drives,
      folders,
      childrenByParent: indexFoldersByParent(folders),
      isDisabled: never,
      disabledReason: noReason,
    });
    expect(rows.map((r) => [r.kind, r.label, "note" in r ? r.note : null])).toEqual([
      ["drive", "Lab", "Everyone in the lab"],
      ["drive", "Core", "Core only"],
    ]);
  });
});

describe("preferred folder type", () => {
  const typed: PickerFolder[] = [
    { id: "a", driveId: "lab", parentId: null, title: "Alpha" },
    { id: "m", driveId: "lab", parentId: null, title: "Zed meetings", folderType: "Meetings" },
    { id: "b", driveId: "lab", parentId: null, title: "Beta" },
  ];

  it("sorts folders of the preferred type first, then by title", () => {
    const kids = indexFoldersByParent(typed, "Meetings").get("lab\0") ?? [];
    expect(kids.map((f) => f.id)).toEqual(["m", "a", "b"]);
  });

  it("sorts by title alone when no type is preferred", () => {
    const kids = indexFoldersByParent(typed).get("lab\0") ?? [];
    expect(kids.map((f) => f.id)).toEqual(["a", "b", "m"]);
  });

  it("marks preferred folder rows and gives Meetings the calendar glyph", () => {
    const rows = buildBrowseRows({
      cwd: { driveId: "lab", folderId: null },
      drives,
      folders: typed,
      childrenByParent: indexFoldersByParent(typed, "Meetings"),
      isDisabled: () => false,
      disabledReason: () => null,
      preferFolderType: "Meetings",
    });
    const folderRows = rows.filter((r) => r.kind === "folder");
    expect(folderRows.map((r) => [r.label, "preferred" in r && r.preferred, "glyph" in r && r.glyph])).toEqual([
      ["Zed meetings", true, "calendar"],
      ["Alpha", false, "folder"],
      ["Beta", false, "folder"],
    ]);
  });

  it("draws the calendar for any Meetings folder, preferred or not", () => {
    expect(folderGlyph("Meetings")).toBe("calendar");
    expect(folderGlyph("Agreements")).toBe("folder");
    expect(folderGlyph(null)).toBe("folder");
  });

  it("isPreferred needs a preferred type that matches", () => {
    expect(isPreferred("Meetings", "Meetings")).toBe(true);
    expect(isPreferred("Meetings", null)).toBe(false);
    expect(isPreferred(null, "Meetings")).toBe(false);
  });

  it("preferFirst keeps each group's order", () => {
    const out = preferFirst([
      { id: 1, preferred: false },
      { id: 2, preferred: true },
      { id: 3, preferred: false },
      { id: 4, preferred: true },
    ]);
    expect(out.map((r) => r.id)).toEqual([2, 4, 1, 3]);
  });
});

describe("recent destinations", () => {
  const d = (n: number) => ({ driveId: "lab", folderId: `f${n}` });

  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(initial?: string) {
    const store = new Map<string, string>(initial === undefined ? [] : [[RECENT_DEST_KEY, initial]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    return store;
  }

  it("puts the newest first and moves a repeat to the front", () => {
    expect(rememberDestination([d(1), d(2)], d(2))).toEqual([d(2), d(1)]);
  });

  it("keeps the last five", () => {
    const list = [1, 2, 3, 4, 5].map(d);
    expect(rememberDestination(list, d(6)).map((x) => x.folderId)).toEqual(["f6", "f1", "f2", "f3", "f4"]);
  });

  it("treats a drive top level and a folder as different destinations", () => {
    const top = { driveId: "lab", folderId: null };
    expect(rememberDestination([top], d(1))).toEqual([d(1), top]);
  });

  it("lists only recents that still exist, in order", () => {
    const kept = existingRecents(
      [d(9), { driveId: "gone", folderId: null }, { driveId: "lab", folderId: "f1" }, { driveId: "lab", folderId: null }],
      drives,
      [{ id: "f1", driveId: "lab", parentId: null, title: "One" }],
    );
    expect(kept).toEqual([{ driveId: "lab", folderId: "f1" }, { driveId: "lab", folderId: null }]);
  });

  it("round-trips through localStorage under the agreed key", () => {
    const store = stubStorage();
    writeRecentDestination(d(1));
    writeRecentDestination(d(2));
    expect(JSON.parse(store.get("dali_drive_recent_dest")!)).toEqual([d(2), d(1)]);
    expect(readRecentDestinations()).toEqual([d(2), d(1)]);
  });

  it("reads nothing from corrupt or malformed storage", () => {
    stubStorage("not json");
    expect(readRecentDestinations()).toEqual([]);
    stubStorage(JSON.stringify({ driveId: "lab" }));
    expect(readRecentDestinations()).toEqual([]);
    stubStorage(JSON.stringify([{ driveId: 3 }, d(1)]));
    expect(readRecentDestinations()).toEqual([d(1)]);
  });

  it("does not throw when storage is unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readRecentDestinations()).toEqual([]);
    expect(() => writeRecentDestination(d(1))).not.toThrow();
  });

  it("lists recents above the drives at the top level, naming their path", () => {
    const rows = buildBrowseRows({
      cwd: { driveId: null, folderId: null },
      drives,
      folders,
      childrenByParent: indexFoldersByParent(folders),
      isDisabled: (x) => x.folderId === "f2",
      disabledReason: () => null,
      recents: [{ driveId: "lab", folderId: "f2" }, { driveId: "core", folderId: null }],
    });
    expect(rows.map((r) => [r.kind, r.label, r.section])).toEqual([
      ["result", "Resources", "Recent"],
      ["result", "Core", "Recent"],
      ["drive", "Lab", "All drives"],
      ["drive", "Core", "All drives"],
    ]);
    expect(rows[0]).toMatchObject({ path: "Lab / Resources", disabled: true });
  });

  it("adds no headings when there are no recents", () => {
    const rows = buildBrowseRows({
      cwd: { driveId: null, folderId: null },
      drives,
      folders,
      childrenByParent: indexFoldersByParent(folders),
      isDisabled: () => false,
      disabledReason: () => null,
    });
    expect(rows.every((r) => r.section === undefined)).toBe(true);
  });
});

describe("destinationPath", () => {
  it("walks the ancestors under the drive label", () => {
    const list: PickerFolder[] = [
      { id: "a", driveId: "lab", parentId: null, title: "Design" },
      { id: "b", driveId: "lab", parentId: "a", title: "" },
    ];
    const path = destinationPath(
      { driveId: "lab", folderId: "b" },
      new Map(drives.map((x) => [x.id, x])),
      new Map(list.map((x) => [x.id, x])),
    );
    expect(path).toEqual(["Lab", "Design", "Untitled folder"]);
  });
});
