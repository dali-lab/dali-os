import { describe, expect, it } from "vitest";
import {
  planFormFolderMirror,
  type InputForm,
  type InputFormFolder,
  type ExistingMirrorPage,
} from "../form-folder-mirror";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function folder(
  id: string,
  name: string,
  parentId: string | null = null,
): InputFormFolder {
  return { id, name, parentId };
}

function form(
  id: string,
  folderId: string | null,
  folderPageId: string | null = null,
): InputForm {
  return { id, folderId, folderPageId };
}

function mirrorPage(
  id: string,
  formFolderId: string,
  title: string,
): ExistingMirrorPage {
  return { id, systemKey: `formfolder:${formFolderId}`, title };
}

const emptyState = {
  formFolders: [] as InputFormFolder[],
  forms: [] as InputForm[],
  existingMirrorPages: [] as ExistingMirrorPage[],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("planFormFolderMirror", () => {
  it("returns an empty plan when everything is already in sync (full no-op)", () => {
    const plan = planFormFolderMirror({
      formFolders: [folder("f1", "Apps"), folder("f2", "Feedback", "f1")],
      forms: [form("frm1", "f1", "page-f1"), form("frm2", "f2", "page-f2")],
      existingMirrorPages: [
        mirrorPage("page-f1", "f1", "Apps"),
        mirrorPage("page-f2", "f2", "Feedback"),
      ],
    });
    expect(plan.foldersToCreate).toHaveLength(0);
    expect(plan.foldersToRename).toHaveLength(0);
    expect(plan.formPlacements).toHaveLength(0);
  });

  it("creates top-level folder when no mirror exists", () => {
    const plan = planFormFolderMirror({
      ...emptyState,
      formFolders: [folder("f1", "Applications")],
    });
    expect(plan.foldersToCreate).toEqual([
      { systemKey: "formfolder:f1", name: "Applications", parentSystemKey: null },
    ]);
    expect(plan.foldersToRename).toHaveLength(0);
  });

  it("creates nested folders with the correct parentSystemKey (multi-level tree)", () => {
    const plan = planFormFolderMirror({
      formFolders: [
        folder("root", "Root"),
        folder("mid", "Middle", "root"),
        folder("leaf", "Leaf", "mid"),
      ],
      forms: [],
      existingMirrorPages: [],
    });
    expect(plan.foldersToCreate).toHaveLength(3);
    expect(plan.foldersToCreate).toContainEqual({
      systemKey: "formfolder:root",
      name: "Root",
      parentSystemKey: null,
    });
    expect(plan.foldersToCreate).toContainEqual({
      systemKey: "formfolder:mid",
      name: "Middle",
      parentSystemKey: "formfolder:root",
    });
    expect(plan.foldersToCreate).toContainEqual({
      systemKey: "formfolder:leaf",
      name: "Leaf",
      parentSystemKey: "formfolder:mid",
    });
  });

  it("places a form at the top level (direct child of a top-level folder)", () => {
    const plan = planFormFolderMirror({
      formFolders: [folder("f1", "Apps")],
      forms: [form("frm1", "f1")],
      existingMirrorPages: [mirrorPage("page-f1", "f1", "Apps")],
    });
    expect(plan.formPlacements).toEqual([
      { formId: "frm1", targetSystemKey: "formfolder:f1" },
    ]);
  });

  it("places forms at multiple nesting levels", () => {
    const plan = planFormFolderMirror({
      formFolders: [folder("root", "Root"), folder("child", "Child", "root")],
      forms: [form("frm-root", "root"), form("frm-child", "child")],
      existingMirrorPages: [
        mirrorPage("page-root", "root", "Root"),
        mirrorPage("page-child", "child", "Child"),
      ],
    });
    expect(plan.formPlacements).toHaveLength(2);
    expect(plan.formPlacements).toContainEqual({
      formId: "frm-root",
      targetSystemKey: "formfolder:root",
    });
    expect(plan.formPlacements).toContainEqual({
      formId: "frm-child",
      targetSystemKey: "formfolder:child",
    });
  });

  it("leaves forms with null folderId untouched (intentionally unplaced)", () => {
    const plan = planFormFolderMirror({
      formFolders: [folder("f1", "Apps")],
      forms: [form("frm-orphan", null)],
      existingMirrorPages: [mirrorPage("page-f1", "f1", "Apps")],
    });
    expect(plan.formPlacements).toHaveLength(0);
  });

  it("skips forms that already have a folderPageId set", () => {
    const plan = planFormFolderMirror({
      formFolders: [folder("f1", "Apps")],
      forms: [form("frm1", "f1", "already-set-page-id")],
      existingMirrorPages: [mirrorPage("page-f1", "f1", "Apps")],
    });
    expect(plan.formPlacements).toHaveLength(0);
  });

  it("emits a rename (not a create) when a mirror Page exists but its title drifted", () => {
    const plan = planFormFolderMirror({
      formFolders: [folder("f1", "Applications Renamed")],
      forms: [],
      existingMirrorPages: [mirrorPage("page-f1", "f1", "Applications Old Name")],
    });
    expect(plan.foldersToCreate).toHaveLength(0);
    expect(plan.foldersToRename).toEqual([
      { pageId: "page-f1", name: "Applications Renamed" },
    ]);
  });

  it("emits neither create nor rename when the mirror Page name is in sync", () => {
    const plan = planFormFolderMirror({
      formFolders: [folder("f1", "Same Name")],
      forms: [],
      existingMirrorPages: [mirrorPage("page-f1", "f1", "Same Name")],
    });
    expect(plan.foldersToCreate).toHaveLength(0);
    expect(plan.foldersToRename).toHaveLength(0);
  });

  it("treats a folder whose parent is absent from the input as top-level (orphan-safe)", () => {
    // "child" claims parentId "missing" which is not in formFolders.
    const plan = planFormFolderMirror({
      formFolders: [folder("child", "Orphan Child", "missing")],
      forms: [],
      existingMirrorPages: [],
    });
    expect(plan.foldersToCreate).toEqual([
      { systemKey: "formfolder:child", name: "Orphan Child", parentSystemKey: null },
    ]);
  });

  it("handles a childless (leaf-only) folder — no forms — without crashing", () => {
    const plan = planFormFolderMirror({
      formFolders: [folder("f1", "Empty Folder")],
      forms: [],
      existingMirrorPages: [],
    });
    expect(plan.foldersToCreate).toHaveLength(1);
    expect(plan.formPlacements).toHaveLength(0);
  });

  it("is idempotent: running again on an already-applied plan produces an empty plan", () => {
    const input = {
      formFolders: [folder("f1", "Apps"), folder("f2", "Feedback", "f1")],
      forms: [form("frm1", "f1"), form("frm2", "f2")],
      existingMirrorPages: [] as ExistingMirrorPage[],
    };

    // First pass: compute the plan.
    const first = planFormFolderMirror(input);

    // Simulate the job having applied the plan: all folders now exist with
    // matching names, all forms now have folderPageId set.
    const appliedPages: ExistingMirrorPage[] = first.foldersToCreate.map((c) => ({
      id: `page-${c.systemKey}`,
      systemKey: c.systemKey,
      title: c.name,
    }));
    const appliedForms: InputForm[] = input.forms.map((f) => ({
      ...f,
      folderPageId: `page-formfolder:${f.folderId}`,
    }));

    const second = planFormFolderMirror({
      formFolders: input.formFolders,
      forms: appliedForms,
      existingMirrorPages: appliedPages,
    });

    expect(second.foldersToCreate).toHaveLength(0);
    expect(second.foldersToRename).toHaveLength(0);
    expect(second.formPlacements).toHaveLength(0);
  });

  it("does not place a form whose folderId references an unknown (deleted) folder", () => {
    // The form has folderId "deleted-folder" but that folder is not in formFolders.
    const plan = planFormFolderMirror({
      formFolders: [folder("f1", "Apps")],
      forms: [form("frm1", "deleted-folder")],
      existingMirrorPages: [mirrorPage("page-f1", "f1", "Apps")],
    });
    expect(plan.formPlacements).toHaveLength(0);
  });
});
