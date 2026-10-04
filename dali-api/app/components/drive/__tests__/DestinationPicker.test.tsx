import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DestinationPicker,
  buildBrowseRows,
  folderNote,
  indexFoldersByParent,
  type Destination,
  type PickerDrive,
  type PickerFolder,
} from "~/components/drive/DestinationPicker";

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

describe("DestinationPicker drive list", () => {
  it("labels each drive with who can see it", () => {
    // Which drive you pick is the part of a move that changes the audience.
    const html = renderToStaticMarkup(
      createElement(DestinationPicker, {
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
