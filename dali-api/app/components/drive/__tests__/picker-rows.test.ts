import { describe, expect, it } from "vitest";
import {
  buildPickerRows,
  keepWritable,
  pickDrives,
  searchRows,
  type PickerRows,
  type PickerScope,
} from "~/components/drive/picker-rows";

const item = (
  id: string,
  parentFolderId: string | null,
  over: Partial<PickerScope["items"][number]> = {},
): PickerScope["items"][number] => ({ type: "folder", id, title: id, iconEmoji: null, parentFolderId, ...over });

const lab: PickerScope = {
  id: "lab",
  label: "Lab-wide",
  iconEmoji: null,
  scopeAudience: "Everyone in the lab",
  items: [
    item("ops", null, { title: "Operations" }),
    item("ops-26f", "ops", { title: "26F" }),
    { type: "doc", id: "d1", title: "Notes", parentFolderId: "ops" },
    { type: "file", id: "x1", title: "a.pdf", parentFolderId: "ops" },
  ],
};

const core: PickerScope = {
  id: "core",
  label: "Core",
  iconEmoji: null,
  rootFolderId: "core-root",
  scopeAudience: "Core only",
  items: [
    item("meet", "core-root", { title: "Meetings", folderType: "Meetings" }),
    item("meet-q", "meet", { title: "Q1" }),
  ],
};

describe("buildPickerRows", () => {
  it("labels the lab scope Lab and carries each scope's audience", () => {
    const { drives } = buildPickerRows([lab, core]);
    expect(drives.map((d) => [d.id, d.label, d.audience])).toEqual([
      ["lab", "Lab", "Everyone in the lab"],
      ["core", "Core", "Core only"],
    ]);
  });

  it("carries the root folder a drive's top level maps to", () => {
    const { drives } = buildPickerRows([lab, core]);
    expect(drives.map((d) => d.rootFolderId)).toEqual([null, "core-root"]);
  });

  it("treats a root drive's direct children as top level", () => {
    const { folders } = buildPickerRows([core]);
    expect(folders.find((f) => f.id === "meet")?.parentId).toBeNull();
    expect(folders.find((f) => f.id === "meet-q")?.parentId).toBe("meet");
  });

  it("keeps a plain drive's DB parents", () => {
    const { folders } = buildPickerRows([lab]);
    expect(folders.find((f) => f.id === "ops")?.parentId).toBeNull();
    expect(folders.find((f) => f.id === "ops-26f")?.parentId).toBe("ops");
  });

  it("counts every direct child, folders and leaves alike", () => {
    const { folders } = buildPickerRows([lab]);
    expect(folders.find((f) => f.id === "ops")?.itemCount).toBe(3);
    expect(folders.find((f) => f.id === "ops-26f")?.itemCount).toBe(0);
  });

  it("lists folders only, tagged with their drive", () => {
    const { folders } = buildPickerRows([lab, core]);
    expect(folders.map((f) => [f.id, f.driveId])).toEqual([
      ["ops", "lab"],
      ["ops-26f", "lab"],
      ["meet", "core"],
      ["meet-q", "core"],
    ]);
  });

  it("passes folderType through, null when absent", () => {
    const { folders } = buildPickerRows([lab, core]);
    expect(folders.find((f) => f.id === "meet")?.folderType).toBe("Meetings");
    expect(folders.find((f) => f.id === "ops")?.folderType).toBeNull();
  });
});

const rows: PickerRows = buildPickerRows([lab, core]);

describe("pickDrives", () => {
  it("drops a drive and its folders", () => {
    const out = pickDrives(rows, (id) => id !== "core");
    expect(out.drives.map((d) => d.id)).toEqual(["lab"]);
    expect(out.folders.every((f) => f.driveId === "lab")).toBe(true);
  });
});

describe("keepWritable", () => {
  it("keeps only writable drives and folders", () => {
    const out = keepWritable(rows, { driveIds: new Set(["lab"]), folderIds: new Set(["ops", "meet"]) });
    expect(out.drives.map((d) => d.id)).toEqual(["lab"]);
    expect(out.folders.map((f) => f.id)).toEqual(["ops"]);
  });

  it("lifts a folder whose parent was dropped to the drive's top level", () => {
    const out = keepWritable(rows, { driveIds: new Set(["lab"]), folderIds: new Set(["ops-26f"]) });
    expect(out.folders).toEqual([expect.objectContaining({ id: "ops-26f", parentId: null })]);
  });

  it("drops the folders of a drive that is not writable even when the folder is", () => {
    const out = keepWritable(rows, { driveIds: new Set(["lab"]), folderIds: new Set(["meet"]) });
    expect(out.folders).toEqual([]);
  });
});

describe("searchRows", () => {
  it("returns everything for a blank query", () => {
    expect(searchRows(rows, "  ")).toBe(rows);
  });

  it("matches a title case-insensitively and returns only those folders and their drives", () => {
    const out = searchRows(rows, "26F");
    expect(out.folders.map((f) => f.id)).toEqual(["ops-26f"]);
    expect(out.drives.map((d) => d.id)).toEqual(["lab"]);
  });

  it("matches on the ancestor path", () => {
    const out = searchRows(rows, "operations");
    expect(out.folders.map((f) => f.id)).toEqual(["ops", "ops-26f"]);
  });

  it("matches on the drive label in the path", () => {
    expect(searchRows(rows, "core").folders.map((f) => f.id)).toEqual(["meet", "meet-q"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchRows(rows, "zzz")).toEqual({ drives: [], folders: [] });
  });
});
