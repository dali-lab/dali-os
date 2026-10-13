import { describe, expect, it } from "vitest";
import {
  descendantFolderIds,
  moveInitial,
  needsAudienceConfirm,
  resolveMoveTarget,
  type MoveTarget,
} from "~/components/drive/move-target";
import type { PickerRows } from "~/components/drive/picker-rows";

const rows: PickerRows = {
  drives: [
    { id: "mine", label: "My Drive" },
    { id: "lab", label: "Lab" },
    { id: "core", label: "Core", rootFolderId: "core-root" },
    { id: "projects", label: "Projects" },
    { id: "education", label: "Education" },
  ],
  folders: [
    { id: "lab-a", driveId: "lab", parentId: null, title: "A" },
    { id: "lab-b", driveId: "lab", parentId: "lab-a", title: "B" },
    { id: "lab-c", driveId: "lab", parentId: "lab-b", title: "C" },
    { id: "core-m", driveId: "core", parentId: null, title: "Meetings" },
    { id: "p1", driveId: "projects", parentId: null, title: "Atlas" },
    { id: "p1-docs", driveId: "projects", parentId: "p1", title: "Docs" },
    { id: "p1-docs-2", driveId: "projects", parentId: "p1-docs", title: "Deep" },
    { id: "o1", driveId: "education", parentId: null, title: "Intro to Design" },
  ],
};

describe("resolveMoveTarget", () => {
  it("sends the Lab top level to the Lab workspace root", () => {
    expect(resolveMoveTarget({ driveId: "lab", folderId: null }, rows)).toEqual({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
      label: "Lab-wide",
      rootDriveId: null,
    });
  });

  it("sends a Lab folder to that folder", () => {
    expect(resolveMoveTarget({ driveId: "lab", folderId: "lab-b" }, rows)).toMatchObject({
      workspaceType: "Lab",
      parentPageId: "lab-b",
    });
  });

  it("files a process root's top level under its root folder", () => {
    expect(resolveMoveTarget({ driveId: "core", folderId: null }, rows)).toMatchObject({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "core-root",
      label: "Core",
      rootDriveId: "core",
    });
    expect(resolveMoveTarget({ driveId: "core", folderId: "core-m" }, rows)?.parentPageId).toBe("core-m");
  });

  it("resolves the project folder itself to the project's top level", () => {
    expect(resolveMoveTarget({ driveId: "projects", folderId: "p1" }, rows)).toEqual({
      workspaceType: "Project",
      workspaceId: "p1",
      parentPageId: null,
      label: "Atlas",
      rootDriveId: null,
    });
  });

  it("resolves a folder anywhere inside a project to that project", () => {
    expect(resolveMoveTarget({ driveId: "projects", folderId: "p1-docs-2" }, rows)).toMatchObject({
      workspaceType: "Project",
      workspaceId: "p1",
      parentPageId: "p1-docs-2",
      label: "Atlas",
    });
  });

  it("resolves an offering the same way", () => {
    expect(resolveMoveTarget({ driveId: "education", folderId: "o1" }, rows)).toMatchObject({
      workspaceType: "EducationOffering",
      workspaceId: "o1",
      parentPageId: null,
    });
  });

  it("refuses the bare Projects and Education lists, My Drive and unknown drives", () => {
    expect(resolveMoveTarget({ driveId: "projects", folderId: null }, rows)).toBeNull();
    expect(resolveMoveTarget({ driveId: "education", folderId: null }, rows)).toBeNull();
    expect(resolveMoveTarget({ driveId: "mine", folderId: null }, rows)).toBeNull();
    expect(resolveMoveTarget({ driveId: "nope", folderId: null }, rows)).toBeNull();
  });

  it("refuses a folder the rows do not hold", () => {
    expect(resolveMoveTarget({ driveId: "projects", folderId: "ghost" }, rows)).toBeNull();
  });
});

describe("needsAudienceConfirm", () => {
  const target = (over: Partial<MoveTarget>): MoveTarget => ({
    workspaceType: "Lab",
    workspaceId: null,
    parentPageId: null,
    label: "Lab-wide",
    rootDriveId: null,
    ...over,
  });

  it("does not ask for a move within the same workspace", () => {
    expect(needsAudienceConfirm(target({}), { type: "Lab", id: null })).toBe(false);
    expect(needsAudienceConfirm(target({}), { type: "Lab" })).toBe(false);
    expect(
      needsAudienceConfirm(target({ workspaceType: "Project", workspaceId: "p1" }), { type: "Project", id: "p1" }),
    ).toBe(false);
  });

  it("asks when the workspace type or id differs", () => {
    expect(needsAudienceConfirm(target({}), { type: "Project", id: "p1" })).toBe(true);
    expect(
      needsAudienceConfirm(target({ workspaceType: "Project", workspaceId: "p2" }), { type: "Project", id: "p1" }),
    ).toBe(true);
  });

  it("asks when moving into a process root", () => {
    expect(needsAudienceConfirm(target({ rootDriveId: "core" }), { type: "Lab", id: null })).toBe(true);
  });
});

describe("moveInitial", () => {
  it("opens a Lab page at Lab", () => {
    expect(moveInitial({ type: "Lab", id: null }, rows)).toEqual({ driveId: "lab", folderId: null });
  });

  it("opens a project page at its project folder", () => {
    expect(moveInitial({ type: "Project", id: "p1" }, rows)).toEqual({ driveId: "projects", folderId: "p1" });
  });

  it("opens an offering page at its offering folder", () => {
    expect(moveInitial({ type: "EducationOffering", id: "o1" }, rows)).toEqual({
      driveId: "education",
      folderId: "o1",
    });
  });

  it("falls back to the picker default when the workspace is not offered", () => {
    expect(moveInitial({ type: "Project", id: "gone" }, rows)).toBeUndefined();
    expect(moveInitial({ type: "Member", id: "u1" }, rows)).toBeUndefined();
    expect(moveInitial({ type: "Lab", id: null }, { drives: [], folders: [] })).toBeUndefined();
  });
});

describe("descendantFolderIds", () => {
  it("is empty when the page is not a folder in the rows", () => {
    expect(descendantFolderIds(rows, "some-doc").size).toBe(0);
  });

  it("holds the folder and everything under it, whatever the list order", () => {
    const shuffled: PickerRows = { ...rows, folders: [...rows.folders].reverse() };
    expect([...descendantFolderIds(shuffled, "lab-a")].sort()).toEqual(["lab-a", "lab-b", "lab-c"]);
  });

  it("leaves siblings and ancestors out", () => {
    expect([...descendantFolderIds(rows, "lab-b")].sort()).toEqual(["lab-b", "lab-c"]);
  });
});
