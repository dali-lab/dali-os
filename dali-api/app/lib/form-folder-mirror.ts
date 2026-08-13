// Pure transformation: plan what Page-folders must be created/renamed and which
// forms need their folderPageId set to complete a FormFolder → Page-folder mirror.
//
// This is called by the `form-folder-mirror` background job but has no Prisma
// dependency so it is unit-testable without a DB. The job applies the plan;
// this function only computes it.
//
// Idempotency key: every mirrored Page-folder carries
//   systemKey = "formfolder:<formFolderId>"
// The job looks these up and hands them in as `existingMirrorPages` so we never
// re-create a folder that is already there — only create missing ones or rename
// drifted ones.

export type InputFormFolder = {
  id: string;
  name: string;
  parentId: string | null; // null = top-level in the FormFolder tree
};

export type InputForm = {
  id: string;
  folderId: string | null; // null = top-level, stays unplaced in the unified tree
  folderPageId: string | null; // already set → we skip it
};

// An existing mirrored Page-folder already in the DB.
export type ExistingMirrorPage = {
  id: string; // Page.id
  systemKey: string; // "formfolder:<formFolderId>"
  title: string; // current name (may have drifted from FormFolder.name)
};

// ─── Plan output ─────────────────────────────────────────────────────────────

// A folder that does not yet have a mirror Page and needs one created.
// parentSystemKey is null for top-level folders; otherwise it references
// another folder's systemKey. The job creates parents before children (two-pass)
// so parentPageId resolution always succeeds.
export type FolderToCreate = {
  systemKey: string; // "formfolder:<formFolderId>"
  name: string;
  parentSystemKey: string | null;
};

// A mirror Page whose name has drifted from the FormFolder name.
export type FolderToRename = {
  pageId: string;
  name: string; // the correct (FormFolder) name
};

// A form that has a folderId but no folderPageId yet (or folderPageId is null).
// The job sets folderPageId to the mirror Page's id. formId uniquely identifies
// the Form row; targetSystemKey tells the job which mirror Page to use.
export type FormPlacement = {
  formId: string;
  targetSystemKey: string; // "formfolder:<folderId>"
};

export type FormFolderMirrorPlan = {
  foldersToCreate: FolderToCreate[];
  foldersToRename: FolderToRename[];
  formPlacements: FormPlacement[];
};

/**
 * Compute the minimal set of writes that bring the Page-folder mirror into sync
 * with the current FormFolder tree.
 *
 * Guarantees:
 *   - Idempotent: calling with an already-synced state returns an all-empty plan.
 *   - Non-destructive: never signals deletion of anything.
 *   - Orphan-safe: a FormFolder whose parent is missing from `formFolders` is
 *     treated as top-level (parentSystemKey = null) rather than blocked.
 *   - Forms with null folderId are left untouched (no placement emitted).
 *   - Forms that already have folderPageId set are left untouched.
 *   - Rename detection: if a mirror Page exists but its title differs from the
 *     FormFolder name, a rename is emitted; no create is emitted for the same folder.
 */
export function planFormFolderMirror({
  formFolders,
  forms,
  existingMirrorPages,
}: {
  formFolders: InputFormFolder[];
  forms: InputForm[];
  existingMirrorPages: ExistingMirrorPage[];
}): FormFolderMirrorPlan {
  // Index existing mirror pages by their systemKey for O(1) lookup.
  const mirrorByKey = new Map<string, ExistingMirrorPage>();
  for (const p of existingMirrorPages) {
    mirrorByKey.set(p.systemKey, p);
  }

  // Index FormFolders by id so we can resolve parentSystemKey.
  const folderById = new Map<string, InputFormFolder>();
  for (const f of formFolders) {
    folderById.set(f.id, f);
  }

  const foldersToCreate: FolderToCreate[] = [];
  const foldersToRename: FolderToRename[] = [];

  for (const folder of formFolders) {
    const systemKey = `formfolder:${folder.id}`;

    // Parent resolution: if the parent is not in our folder set (orphan case),
    // treat this folder as top-level.
    const parentSystemKey =
      folder.parentId && folderById.has(folder.parentId)
        ? `formfolder:${folder.parentId}`
        : null;

    const existing = mirrorByKey.get(systemKey);
    if (!existing) {
      foldersToCreate.push({ systemKey, name: folder.name, parentSystemKey });
    } else if (existing.title !== folder.name) {
      // Mirror Page exists but drifted — rename only, no create.
      foldersToRename.push({ pageId: existing.id, name: folder.name });
    }
    // If it exists and name matches: already in sync, nothing to do.
  }

  const formPlacements: FormPlacement[] = [];
  for (const form of forms) {
    // Null folderId = intentionally unplaced; skip.
    if (!form.folderId) continue;
    // Already placed in the unified tree; skip.
    if (form.folderPageId) continue;
    // Only place if the target folder is in our known FormFolder set —
    // avoids referencing a folder that may have been deleted between queries.
    if (!folderById.has(form.folderId)) continue;

    formPlacements.push({
      formId: form.id,
      targetSystemKey: `formfolder:${form.folderId}`,
    });
  }

  return { foldersToCreate, foldersToRename, formPlacements };
}
