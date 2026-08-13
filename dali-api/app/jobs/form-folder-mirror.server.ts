// FormFolder → Page-folder mirror job.
//
// Wave 3 of Drive consolidation: mirrors the existing FormFolder hierarchy into
// Page rows (kind=Folder, workspaceType=Lab) so the unified DriveTree can show
// forms organised into the same folder structure as FormsBrowser does today.
//
// This is an EXPAND-phase backfill — FormFolder and Form.folderId are fully
// preserved; we only SET Form.folderPageId and create the mirror Page-folders.
// The FormsBrowser and all form routes are untouched.
//
// Idempotency: each mirror Page carries systemKey = "formfolder:<formFolderId>".
// Re-running against an already-synced DB produces no DB writes (pure no-op).
//
// Two-pass parent creation: we create all folders in one transaction but ordered
// so parents come before children — a simple topological sort over the parentId
// chain. This means parentPageId resolution always finds its parent already in
// the same upsert batch.
//
// Seeded DISABLED so it only runs when an operator turns it on in Admin → Jobs
// at feature-rollout time. It does not interact with the /documents hub or any
// user-facing route until the `drive-consolidation` flag gates the DriveTree.

import { prisma } from "~/lib/db";
import {
  planFormFolderMirror,
  type InputForm,
  type ExistingMirrorPage,
} from "~/lib/form-folder-mirror";
import type { JobContext, JobResult } from "~/jobs/registry";

const SYSTEM_KEY_PREFIX = "formfolder:";

// A FormFolder record enriched with the createdById we carry onto the mirror Page.
type RawFormFolder = {
  id: string;
  name: string;
  parentId: string | null;
  createdById: string;
};

// Topological sort: returns folders ordered so every parent appears before its
// children. Folders whose parentId is absent from the set are treated as roots.
function topoSort(folders: RawFormFolder[]): RawFormFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const visited = new Set<string>();
  const result: RawFormFolder[] = [];

  function visit(f: RawFormFolder) {
    if (visited.has(f.id)) return;
    // Visit parent first (if it's in scope).
    if (f.parentId && byId.has(f.parentId)) {
      visit(byId.get(f.parentId)!);
    }
    visited.add(f.id);
    result.push(f);
  }

  for (const f of folders) {
    visit(f);
  }
  return result;
}

export async function runFormFolderMirror(_ctx: JobContext): Promise<JobResult> {
  // ── 1. Load inputs ──────────────────────────────────────────────────────────
  const [rawFolders, rawForms, rawMirrorPages] = await Promise.all([
    prisma.formFolder.findMany({
      select: { id: true, name: true, parentId: true, createdById: true },
    }),
    prisma.form.findMany({
      select: { id: true, folderId: true, folderPageId: true },
    }),
    prisma.page.findMany({
      where: { systemKey: { startsWith: SYSTEM_KEY_PREFIX } },
      select: { id: true, systemKey: true, title: true },
    }),
  ]);

  const formFolders: RawFormFolder[] = rawFolders;
  const forms: InputForm[] = rawForms;

  // Build a lookup for the full folder records (including createdById) so the
  // apply pass can attribute each mirror Page to the original FormFolder author.
  const folderRecordById = new Map<string, RawFormFolder>(
    formFolders.map((f) => [f.id, f]),
  );
  const existingMirrorPages: ExistingMirrorPage[] = rawMirrorPages.map((p) => ({
    id: p.id,
    // systemKey is non-null here because we filtered by prefix above.
    systemKey: p.systemKey!,
    title: p.title,
  }));

  // ── 2. Plan ─────────────────────────────────────────────────────────────────
  const plan = planFormFolderMirror({ formFolders, forms, existingMirrorPages });

  const { foldersToCreate, foldersToRename, formPlacements } = plan;

  if (
    foldersToCreate.length === 0 &&
    foldersToRename.length === 0 &&
    formPlacements.length === 0
  ) {
    return { items: 0, note: "already in sync — no-op" };
  }

  // ── 3. Apply ─────────────────────────────────────────────────────────────────
  // Index existing mirror pages by systemKey so we can look up parentPageId
  // during the create pass.
  const mirrorIdByKey = new Map<string, string>(
    existingMirrorPages.map((p) => [p.systemKey, p.id]),
  );

  await prisma.$transaction(async (tx) => {
    // 3a. Create new mirror Page-folders — topologically sorted so parents
    //     precede children; we carry the resolved parentPageId forward into
    //     each create so the DB row is complete in one pass.
    const foldersToCreateRecords: RawFormFolder[] = foldersToCreate.map((c) => {
      const formFolderId = c.systemKey.slice(SYSTEM_KEY_PREFIX.length);
      const record = folderRecordById.get(formFolderId)!;
      return record;
    });
    const sorted = topoSort(foldersToCreateRecords);

    for (const sf of sorted) {
      const systemKey = `${SYSTEM_KEY_PREFIX}${sf.id}`;
      const toCreate = foldersToCreate.find((c) => c.systemKey === systemKey)!;
      const parentPageId = toCreate.parentSystemKey
        ? mirrorIdByKey.get(toCreate.parentSystemKey) ?? null
        : null;

      const created = await tx.page.create({
        data: {
          title: toCreate.name,
          kind: "Folder",
          workspaceType: "Lab",
          // workspaceId null = lab-global, matching other Lab-scope Pages.
          workspaceId: null,
          parentPageId,
          systemKey,
          // Attribute the mirror Page to the FormFolder's original author.
          // No user-facing "who created this folder" surface reads this for
          // system-key pages (the API guards archive/move on systemKey), but
          // the schema requires a non-null FK.
          createdById: sf.createdById,
        },
        select: { id: true },
      });

      // Make the new id available for child-folder resolution in subsequent
      // iterations of this same create pass.
      mirrorIdByKey.set(systemKey, created.id);
    }

    // 3b. Rename drifted mirror Pages.
    for (const r of foldersToRename) {
      await tx.page.update({
        where: { id: r.pageId },
        data: { title: r.name },
      });
    }

    // 3c. Set Form.folderPageId for forms that now have a resolved mirror Page.
    for (const fp of formPlacements) {
      const folderPageId = mirrorIdByKey.get(fp.targetSystemKey);
      if (!folderPageId) {
        // Mirror Page wasn't created this run and wasn't pre-existing — shouldn't
        // happen if planFormFolderMirror is correct, but guard defensively.
        console.warn(
          `[jobs] form-folder-mirror: no mirror page for ${fp.targetSystemKey}; skipping form ${fp.formId}`,
        );
        continue;
      }
      await tx.form.update({
        where: { id: fp.formId },
        data: { folderPageId },
      });
    }
  });

  // ── 4. Reconciliation check ──────────────────────────────────────────────────
  // After applying, verify the DB reflects what we intended. Log warnings on
  // mismatch but never throw — a warning on a tick is better than a crash loop.
  const [mirrorCount, unplacedFormCount] = await Promise.all([
    prisma.page.count({
      where: { systemKey: { startsWith: SYSTEM_KEY_PREFIX } },
    }),
    prisma.form.count({
      where: {
        folderId: { not: null },
        folderPageId: null,
      },
    }),
  ]);

  const expectedMirrorCount = formFolders.length;
  if (mirrorCount < expectedMirrorCount) {
    console.warn(
      `[jobs] form-folder-mirror: reconciliation mismatch — expected ${expectedMirrorCount} mirror page(s), found ${mirrorCount}`,
    );
  }
  if (unplacedFormCount > 0) {
    console.warn(
      `[jobs] form-folder-mirror: ${unplacedFormCount} form(s) with folderId still have no folderPageId after apply`,
    );
  }

  const note = [
    foldersToCreate.length > 0
      ? `${foldersToCreate.length} folder(s) mirrored`
      : null,
    foldersToRename.length > 0
      ? `${foldersToRename.length} folder(s) renamed`
      : null,
    formPlacements.length > 0
      ? `${formPlacements.length} form(s) placed`
      : null,
    foldersToCreate.length === 0 &&
    foldersToRename.length === 0 &&
    formPlacements.length === 0
      ? "already in sync"
      : null,
  ]
    .filter(Boolean)
    .join("; ");

  return {
    items: foldersToCreate.length + foldersToRename.length + formPlacements.length,
    note,
  };
}
