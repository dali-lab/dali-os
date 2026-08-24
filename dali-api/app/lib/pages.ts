import { prisma } from "~/lib/db";
import type { PageKind } from "~/generated/prisma/client";

// Creates a Page in a project's workspace (the same Page model the project
// Overview/PRD/Documents-block use). Appends after the current max position
// among sibling pages under the same parent (top-level when parentPageId is
// null). Shared by the manual "add document"/"add folder" routes and any
// flow that auto-creates a project document (e.g. meeting notes).
export async function createProjectPage(input: {
  projectId: string;
  title: string;
  createdById: string;
  meetingNoteId?: string;
  parentPageId?: string | null;
  kind?: PageKind;
}): Promise<{ id: string }> {
  const parentPageId = input.parentPageId ?? null;
  const last = await prisma.page.findFirst({
    where: { workspaceType: "Project", workspaceId: input.projectId, parentPageId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  return prisma.page.create({
    data: {
      workspaceType: "Project",
      workspaceId: input.projectId,
      title: input.title,
      kind: input.kind ?? "FreeForm",
      position,
      parentPageId,
      createdById: input.createdById,
      meetingNoteId: input.meetingNoteId ?? null,
    },
    select: { id: true },
  });
}

// Creates a top-level Page in the Lab workspace (workspaceId null — see
// Page.workspaceType comment in schema.prisma). Used for the meeting-note
// page of a project-less meetingType'd ScheduledMeeting (e.g. an all-lab
// SelfCheckIn event with no single owning project) — same shape as
// createProjectPage, just scoped to the Lab workspace instead of a project.
export async function createLabMeetingPage(input: {
  title: string;
  createdById: string;
  meetingNoteId?: string;
}): Promise<{ id: string }> {
  const last = await prisma.page.findFirst({
    where: { workspaceType: "Lab", workspaceId: null, parentPageId: null },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  return prisma.page.create({
    data: {
      workspaceType: "Lab",
      workspaceId: null,
      title: input.title,
      kind: "FreeForm",
      position,
      createdById: input.createdById,
      meetingNoteId: input.meetingNoteId ?? null,
      // Lab docs default to the communal shelf: everyone in the lab can edit.
      linkAccess: "LabMembers",
      linkPermission: "Edit",
    },
    select: { id: true },
  });
}

// ─── Nesting guards ──────────────────────────────────────────────────────────

// Maximum allowed depth in the page tree. Depth 0 = top-level; depth 6 = six
// levels of nesting. Capped here rather than the DB so the walk stays bounded.
export const MAX_PAGE_DEPTH = 6;

/**
 * Walk the parentPageId chain from `startId` (exclusive) toward the root,
 * returning the depth of `startId` itself (0 = root).  Returns -1 if any
 * ancestor is not found (broken chain) or if the chain would exceed
 * MAX_PAGE_DEPTH + 1 (avoids infinite loops on cyclic data).
 */
export async function pageDepth(startId: string): Promise<number> {
  let id: string | null = startId;
  let depth = 0;
  while (id !== null) {
    if (depth > MAX_PAGE_DEPTH + 1) return -1; // runaway guard
    const row: { parentPageId: string | null } | null = await prisma.page.findUnique({
      where: { id },
      select: { parentPageId: true },
    });
    if (!row) return -1;
    id = row.parentPageId;
    if (id !== null) depth++;
  }
  return depth;
}

/**
 * Returns true if `ancestorId` appears anywhere in the ancestor chain of
 * `pageId`. Used to prevent cyclic moves: before setting page.parentPageId =
 * newParentId, check `isAncestor(newParentId, pageId)` and reject if true.
 * Bounded by MAX_PAGE_DEPTH + 2 to handle broken/cyclic chains gracefully.
 */
export async function isAncestorOf(
  ancestorId: string,
  pageId: string,
): Promise<boolean> {
  let id: string | null = pageId;
  let steps = 0;
  while (id !== null) {
    if (steps > MAX_PAGE_DEPTH + 2) return false; // broken/cyclic chain
    const row: { parentPageId: string | null } | null = await prisma.page.findUnique({
      where: { id },
      select: { parentPageId: true },
    });
    if (!row) return false;
    id = row.parentPageId;
    if (id === ancestorId) return true;
    steps++;
  }
  return false;
}

// Creates a Page in the Lab workspace (workspaceType=Lab, workspaceId=null —
// see Page.workspaceType comment in schema.prisma). Same shape as
// createProjectPage but for the lab-wide Documents area: supports Folder-kind
// containers and one level of nesting under a top-level folder. Appends after
// the current max position among siblings under the same parent.
export async function createLabPage(input: {
  title: string;
  createdById: string;
  parentPageId?: string | null;
  kind?: PageKind;
  /** Override the default communal general access. Pass "Restricted" for pages
   *  created inside a scoped drive (e.g. Core), so the scope governs access and
   *  the "everyone in the lab" link grant doesn't silently widen them. */
  restricted?: boolean;
}): Promise<{ id: string }> {
  const parentPageId = input.parentPageId ?? null;
  const last = await prisma.page.findFirst({
    where: { workspaceType: "Lab", workspaceId: null, parentPageId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  return prisma.page.create({
    data: {
      workspaceType: "Lab",
      workspaceId: null,
      title: input.title,
      kind: input.kind ?? "FreeForm",
      position,
      parentPageId,
      createdById: input.createdById,
      // Lab docs default to the communal shelf (everyone in the lab can edit);
      // pages inside a scoped drive start Restricted so the scope is authoritative.
      linkAccess: input.restricted ? "Restricted" : "LabMembers",
      linkPermission: input.restricted ? "View" : "Edit",
    },
    select: { id: true },
  });
}

// Idempotently ensures the lab-wide "Core" drive root exists: a top-level Lab
// Folder scoped to the Core group. scopeKind=Group cascades Core-only access to
// everything inside it (getPageAccess ancestry walk), and linkAccess=Restricted
// keeps it hidden from non-Core members on every list surface (same protection
// existing Restricted lab docs already rely on). Its systemKey both dedupes and
// stops api.documents.$id deleting it. Returns the folder id, or null if the
// Core GroupDefinition hasn't been provisioned yet (syncDefaultGroups seeds it).
export async function ensureCoreDriveRoot(createdById: string): Promise<{ id: string } | null> {
  const systemKey = "drive:core-root";

  // ── 1. Ensure the Core root exists ───────────────────────────────────────
  let rootId: string;
  const existing = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
  if (existing) {
    rootId = existing.id;
  } else {
    const coreGroup = await prisma.groupDefinition.findUnique({
      where: { systemKey: "core" },
      select: { id: true },
    });
    if (!coreGroup) return null;

    try {
      const last = await prisma.page.findFirst({
        where: { workspaceType: "Lab", workspaceId: null, parentPageId: null },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const root = await prisma.page.create({
        data: {
          workspaceType: "Lab",
          workspaceId: null,
          title: "Core",
          kind: "Folder",
          position: last ? last.position + 1 : 0,
          createdById,
          systemKey,
          scopeKind: "Group",
          scopeGroupId: coreGroup.id,
          scopePermission: "Edit",
          // Restricted: the scope grants Core; nobody reaches it via the lab link.
          linkAccess: "Restricted",
          linkPermission: "View",
        },
        select: { id: true },
      });
      rootId = root.id;
    } catch {
      const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
      if (retry) {
        rootId = retry.id;
      } else {
        throw new Error("Failed to ensure Core drive root");
      }
    }
  }

  // ── 2. Ensure the "Templates" area + adopt email templates ───────────────
  // Email templates are global (bound by hiring cycles AND education offerings),
  // so they live in a Core-managed Templates area rather than the Hiring drive.
  // Child folders inherit the Core root's Restricted scope, so this stays
  // Core-only. Best-effort: a failure here doesn't block the root return.
  try {
    const templatesRoot = await ensureSystemChildFolder(
      "drive:core-templates",
      rootId,
      "Templates",
      createdById,
    );
    const [hiringFolder, educationFolder] = await Promise.all([
      ensureSystemChildFolder("drive:core-templates-hiring", templatesRoot, "Hiring", createdById),
      ensureSystemChildFolder("drive:core-templates-education", templatesRoot, "Education", createdById),
    ]);
    await adoptEmailTemplatesByBinding({ templatesRoot, hiringFolder, educationFolder });
  } catch {
    // Templates provisioning is best-effort — never block the Core drive.
  }

  // ── 3. Ensure "Agreements" + "Rubrics" areas + adopt into them ───────────
  // Agreements and rubrics are Core-managed and confined to these
  // areas, so they never float loose in the Lab drive. Both were previously
  // filed under the Hiring root — re-home any stragglers found there too, so
  // existing data migrates to the Core drive.
  try {
    const hiringRootId = (
      await prisma.page.findUnique({
        where: { systemKey: "drive:hiring-root" },
        select: { id: true },
      })
    )?.id ?? null;

    const agreementsRoot = await ensureSystemChildFolder(
      "drive:core-agreements",
      rootId,
      "Agreements",
      createdById,
    );
    // Agreements live flat in this one folder. Migrate off the legacy per-kind
    // subfolders (re-home their docs, then delete the emptied folders), then
    // file any unplaced/stray agreements here.
    await flattenLegacyKindFolders(agreementsRoot);
    await adoptAgreements(agreementsRoot, hiringRootId);

    // Legacy Core ▸ Rubrics: rubrics now live in Hiring ▸ Rubrics. The Hiring
    // drive's adoptRubricsToHiring re-homes any rows still pointing at the old
    // Core folder on every Hiring-drive visit. Once the folder is empty we can
    // safely delete it; until then we leave it alone so existing page refs
    // (bookmarks, collab links) don't 404.
    await deleteCoreLegacyRubricsIfEmpty();
  } catch {
    // Best-effort — never block the Core drive.
  }

  return { id: rootId };
}

/** Items to (re-)file into a Core folder: those never placed (null) plus any
 *  previously auto-filed into the old Hiring root. Manual placements elsewhere
 *  are left alone. */
function strayFilter(hiringRootId: string | null): { folderPageId: string | null }[] {
  return hiringRootId ? [{ folderPageId: null }, { folderPageId: hiringRootId }] : [{ folderPageId: null }];
}

// Legacy Core ▸ Agreements per-kind subfolders (removed 2026-08 — agreements now
// live flat in the single Agreements folder). ensureCoreDriveRoot re-homes any
// docs still filed here and deletes these folders on the next Core-drive visit.
const LEGACY_AGREEMENT_KIND_FOLDER_KEYS = [
  "drive:core-agreements-general",
  "drive:core-agreements-member",
  "drive:core-agreements-mentorship",
  "drive:core-agreements-confidentiality",
];

/** Idempotently ensure a system-keyed child Folder page under `parentPageId`.
 *  No explicit scope — it inherits access from its ancestor scoped root. */
async function ensureSystemChildFolder(
  systemKey: string,
  parentPageId: string,
  title: string,
  createdById: string,
): Promise<string> {
  const existing = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
  if (existing) return existing.id;
  const last = await prisma.page.findFirst({
    where: { parentPageId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  try {
    const created = await prisma.page.create({
      data: {
        workspaceType: "Lab",
        workspaceId: null,
        parentPageId,
        title,
        kind: "Folder",
        position: last ? last.position + 1 : 0,
        createdById,
        systemKey,
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
    if (retry) return retry.id;
    throw new Error(`Failed to ensure folder ${systemKey}`);
  }
}

/** File unplaced email templates into the Templates area by their bindings:
 *  hiring-only → Hiring, education-only → Education, both/neither → Templates
 *  root. Placement is decoupled from function (bindings are untouched), so
 *  operators can freely re-file afterward. Only touches unplaced (null) rows,
 *  so placed templates stay where they were moved. */
async function adoptEmailTemplatesByBinding(folders: {
  templatesRoot: string;
  hiringFolder: string;
  educationFolder: string;
}): Promise<void> {
  const unplaced = await prisma.emailTemplate.findMany({
    where: { folderPageId: null },
    select: {
      id: true,
      versions: {
        select: {
          _count: {
            select: {
              cycleDecisionEmails: true,
              cycleNotificationEmails: true,
              educationDecisionEmails: true,
            },
          },
        },
      },
    },
  });
  if (unplaced.length === 0) return;

  const toHiring: string[] = [];
  const toEducation: string[] = [];
  const toRoot: string[] = [];
  for (const t of unplaced) {
    let hiring = 0;
    let education = 0;
    for (const v of t.versions) {
      hiring += v._count.cycleDecisionEmails + v._count.cycleNotificationEmails;
      education += v._count.educationDecisionEmails;
    }
    if (hiring > 0 && education === 0) toHiring.push(t.id);
    else if (education > 0 && hiring === 0) toEducation.push(t.id);
    else toRoot.push(t.id);
  }

  await Promise.all(
    [
      toHiring.length && { ids: toHiring, folderPageId: folders.hiringFolder },
      toEducation.length && { ids: toEducation, folderPageId: folders.educationFolder },
      toRoot.length && { ids: toRoot, folderPageId: folders.templatesRoot },
    ]
      .filter((x): x is { ids: string[]; folderPageId: string } => Boolean(x))
      .map((g) =>
        prisma.emailTemplate.updateMany({
          where: { id: { in: g.ids } },
          data: { folderPageId: g.folderPageId },
        }),
      ),
  );
}

/** File signing documents into the single Agreements folder. Touches unplaced
 *  rows plus any previously filed under the old Hiring root (Confidentiality
 *  agreements) — see strayFilter — so placed agreements a Core user moved
 *  deliberately stay put. */
async function adoptAgreements(
  agreementsRoot: string,
  hiringRootId: string | null,
): Promise<void> {
  await prisma.signingDocument.updateMany({
    where: { OR: strayFilter(hiringRootId) },
    data: { folderPageId: agreementsRoot },
  });
}

/** One-time flatten: re-home agreements out of the legacy per-kind subfolders
 *  into the single Agreements folder, then delete the emptied kind folders.
 *  Idempotent — a no-op once the legacy folders are gone. */
async function flattenLegacyKindFolders(agreementsRoot: string): Promise<void> {
  const legacy = await prisma.page.findMany({
    where: { systemKey: { in: LEGACY_AGREEMENT_KIND_FOLDER_KEYS } },
    select: { id: true },
  });
  if (legacy.length === 0) return;
  const ids = legacy.map((p) => p.id);
  await prisma.signingDocument.updateMany({
    where: { folderPageId: { in: ids } },
    data: { folderPageId: agreementsRoot },
  });
  await prisma.page.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Auto-provisioned "Hiring" Drive root — the scoped folder where all hiring
 * artifacts (application/challenge Forms, Rubrics, Confidentiality agreements)
 * live in Drive. Mirrors ensureCoreDriveRoot, but scoped to the dynamic
 * "hiring" group (Core + domain leads + cycle reviewers/interviewers) so anyone
 * with hiring access sees it and nobody else does. Idempotent via systemKey.
 *
 * Adoption (setting folderPageId = root for unplaced hiring artifacts) runs on
 * EVERY call — not just on first creation — so newly-created rubrics and
 * agreements are picked up on the next Drive visit without a separate backfill.
 * Each adoption query is a no-op once all rows are placed, so repeat calls are
 * cheap.
 */
export async function ensureHiringDriveRoot(createdById: string): Promise<{ id: string } | null> {
  const systemKey = "drive:hiring-root";

  // ── 1. Ensure the root exists ────────────────────────────────────────────
  let rootId: string;

  const existing = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
  if (existing) {
    rootId = existing.id;
  } else {
    // Self-contained: guarantee the dynamic hiring group exists (avoids a
    // circular import of groups.ts). Membership resolves via dynamicQuery.
    const hiringGroup = await prisma.groupDefinition.upsert({
      where: { systemKey: "hiring" },
      update: {},
      create: { name: "Hiring team", type: "Dynamic", dynamicQuery: "hiring", systemKey: "hiring" },
      select: { id: true },
    });

    try {
      const last = await prisma.page.findFirst({
        where: { workspaceType: "Lab", workspaceId: null, parentPageId: null },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const root = await prisma.page.create({
        data: {
          workspaceType: "Lab",
          workspaceId: null,
          title: "Hiring",
          kind: "Folder",
          position: last ? last.position + 1 : 0,
          createdById,
          systemKey,
          scopeKind: "Group",
          scopeGroupId: hiringGroup.id,
          scopePermission: "Edit",
          // Restricted: the scope grants the hiring team; nobody reaches it via
          // the lab link.
          linkAccess: "Restricted",
          linkPermission: "View",
        },
        select: { id: true },
      });
      rootId = root.id;
    } catch {
      const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
      if (retry) {
        rootId = retry.id;
      } else {
        throw new Error("Failed to ensure Hiring drive root");
      }
    }
  }

  // ── 2. Idempotent adoption — runs on every call ──────────────────────────
  // Each query is a no-op once all artifacts are placed, so this is cheap on
  // repeat calls. Best-effort: a failure here doesn't block the root return.
  try {
    // Idempotent rekey: the old systemKey used a colon separator
    // ("drive:hiring:rubrics") inconsistent with every other hiring key's
    // dash style. Migrate in-place so the unique constraint on systemKey
    // doesn't create a duplicate folder if the old row already exists.
    await prisma.page.updateMany({
      where: { systemKey: "drive:hiring:rubrics" },
      data: { systemKey: "drive:hiring-rubrics" },
    });

    // Forms: updateMany doesn't support to-many relation filters, so we
    // findMany first to get the scalar id list, then updateMany by id.
    const unplacedForms = await prisma.form.findMany({
      where: {
        folderPageId: null,
        OR: [
          { hiringCyclesAsApplicationForm: { some: {} } },
          { hiringDomainChallenges: { some: {} } },
        ],
      },
      select: { id: true },
    });
    if (unplacedForms.length > 0) {
      await prisma.form.updateMany({
        where: { id: { in: unplacedForms.map((f) => f.id) } },
        data: { folderPageId: rootId },
      });
    }

    // Rubrics: adopted into Hiring ▸ Rubrics because the nav (nav-areas.ts)
    // puts rubrics under Hiring ▸ Library. Previously filed under Core ▸
    // Rubrics; re-home any stray rows so Drive and the nav stay consistent.
    // Agreements and email templates remain in the Core drive.
    const rubricsFolder = await ensureSystemChildFolder(
      "drive:hiring-rubrics",
      rootId,
      "Rubrics",
      createdById,
    );
    await adoptRubricsToHiring(rubricsFolder);

    // Education offering application forms: file any unplaced form that is
    // bound to an EducationOffering (via applicationFormId) into a managed
    // folder within that offering's workspace. Best-effort, idempotent.
    await adoptEducationForms(createdById);
  } catch {
    // Adoption is best-effort; don't surface errors to the caller.
  }

  return { id: rootId };
}

/**
 * Auto-provisioned Drive folder for a single EducationOffering — a top-level
 * folder in that offering's workspace where uploaded files (ProjectFile rows)
 * are placed. Idempotent via systemKey. Best-effort adoption of unplaced
 * ProjectFile rows runs on every call (cheap no-op once all rows are placed).
 *
 * Returns null only if the offering doesn't exist; throws on genuine DB errors
 * so callers can decide whether to swallow or propagate.
 */
export async function ensureOfferingDriveFolder(
  offeringId: string,
  createdById: string,
): Promise<{ id: string } | null> {
  const systemKey = `drive:offering:${offeringId}`;

  // ── 1. Ensure the root exists ────────────────────────────────────────────
  let rootId: string;

  const existing = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
  if (existing) {
    rootId = existing.id;
  } else {
    const offering = await prisma.educationOffering.findUnique({
      where: { id: offeringId },
      select: { title: true },
    });
    if (!offering) return null;

    try {
      const last = await prisma.page.findFirst({
        where: {
          workspaceType: "EducationOffering",
          workspaceId: offeringId,
          parentPageId: null,
        },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const root = await prisma.page.create({
        data: {
          workspaceType: "EducationOffering",
          workspaceId: offeringId,
          title: offering.title,
          kind: "Folder",
          position: last ? last.position + 1 : 0,
          parentPageId: null,
          createdById,
          systemKey,
          linkAccess: "Restricted",
          linkPermission: "View",
        },
        select: { id: true },
      });
      rootId = root.id;
    } catch {
      // Race: another request created it between our lookup and create.
      const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
      if (retry) {
        rootId = retry.id;
      } else {
        throw new Error(`Failed to ensure Drive folder for offering ${offeringId}`);
      }
    }
  }

  // ── 2. Idempotent adoption — runs on every call ──────────────────────────
  // Adopt unplaced ProjectFile rows for this offering so uploaded files land
  // in the folder without a separate backfill. No-op once all rows are placed.
  try {
    await prisma.projectFile.updateMany({
      where: {
        workspaceType: "EducationOffering",
        workspaceId: offeringId,
        folderPageId: null,
        archivedAt: null,
      },
      data: { folderPageId: rootId },
    });
  } catch {
    // Adoption is best-effort; don't surface errors to the caller.
  }

  return { id: rootId };
}

/** Move rubrics from the old Core ▸ Rubrics folder (and any unplaced ones)
 *  into the new Hiring ▸ Rubrics folder. Only touches rubrics that are either
 *  unplaced or still in the legacy Core rubrics folder — manual re-files by
 *  Core members are left alone. Idempotent: once all rows have the Hiring
 *  folder id the query returns zero rows. */
async function adoptRubricsToHiring(hiringRubricsFolderId: string): Promise<void> {
  // Resolve the old Core ▸ Rubrics folder (may not exist on a fresh DB).
  const coreRubricsPage = await prisma.page.findUnique({
    where: { systemKey: "drive:core-rubrics" },
    select: { id: true },
  });
  const stray: { folderPageId: string | null }[] = [{ folderPageId: null }];
  if (coreRubricsPage) stray.push({ folderPageId: coreRubricsPage.id });

  await prisma.rubric.updateMany({
    where: { OR: stray },
    data: { folderPageId: hiringRubricsFolderId },
  });
}

/** Delete the legacy Core ▸ Rubrics folder (systemKey drive:core-rubrics) if
 *  it exists, has no child pages, and has no rubrics still pointing at it.
 *  adoptRubricsToHiring re-homes all rubric rows first, so on a normal run
 *  this is satisfied immediately and the zombie folder is pruned. If anything
 *  still references the folder, we leave it alone — safety over cleanup. */
async function deleteCoreLegacyRubricsIfEmpty(): Promise<void> {
  const folder = await prisma.page.findUnique({
    where: { systemKey: "drive:core-rubrics" },
    select: { id: true },
  });
  if (!folder) return; // already gone or never created — nothing to do

  const [childCount, rubricCount] = await Promise.all([
    prisma.page.count({ where: { parentPageId: folder.id } }),
    prisma.rubric.count({ where: { folderPageId: folder.id } }),
  ]);

  if (childCount > 0 || rubricCount > 0) return; // folder still in use

  await prisma.page.delete({ where: { id: folder.id } });
}

/** Idempotently ensure the managed "Forms" folder inside an EducationOffering's
 *  workspace (systemKey education:<offeringId>:forms-folder) and return its id.
 *  This is the home for the offering's application form, so it lives WITH its
 *  offering (under the Education space) rather than a shared lab folder. The
 *  offering workspace is represented as workspaceType=EducationOffering pages. */
export async function ensureOfferingFormsFolder(
  offeringId: string,
  createdById: string,
): Promise<string> {
  const systemKey = `education:${offeringId}:forms-folder`;
  const existing = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
  if (existing) return existing.id;
  try {
    const last = await prisma.page.findFirst({
      where: { workspaceType: "EducationOffering", workspaceId: offeringId, parentPageId: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const created = await prisma.page.create({
      data: {
        workspaceType: "EducationOffering",
        workspaceId: offeringId,
        title: "Forms",
        kind: "Folder",
        position: last ? last.position + 1 : 0,
        createdById,
        systemKey,
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
    if (retry) return retry.id;
    throw new Error(`Failed to ensure offering forms folder ${systemKey}`);
  }
}

/** Re-home EducationOffering application forms into each offering's own
 *  workspace "Forms" folder (ensureOfferingFormsFolder) — both never-placed
 *  forms and any still sitting in the legacy loose top-level "Education" Lab
 *  folder (a FormFolder→Page mirror older builds filed them into). Archives that
 *  legacy folder once it's empty so it stops floating in the General drive next
 *  to the Education space. Idempotent; best-effort — errors here never block the
 *  Hiring drive root return. */
async function adoptEducationForms(createdById: string): Promise<void> {
  // The legacy loose "Education" folder (identified by its FormFolder-mirror
  // systemKey so a user-created "Education" folder is never touched).
  const looseFolder = await prisma.page.findFirst({
    where: {
      title: "Education",
      kind: "Folder",
      workspaceType: "Lab",
      parentPageId: null,
      archivedAt: null,
      systemKey: { startsWith: "formfolder:" },
    },
    select: { id: true },
  });
  const looseId = looseFolder?.id ?? null;

  // Offerings whose application form is unplaced or still in the loose folder.
  const strayForm = looseId
    ? { OR: [{ folderPageId: null }, { folderPageId: looseId }] }
    : { folderPageId: null };
  const offerings = await prisma.educationOffering.findMany({
    where: { applicationFormId: { not: null }, applicationForm: strayForm },
    select: { id: true, applicationFormId: true },
  });

  for (const offering of offerings) {
    if (!offering.applicationFormId) continue;
    try {
      const folderId = await ensureOfferingFormsFolder(offering.id, createdById);
      await prisma.form.updateMany({
        where: { id: offering.applicationFormId, ...strayForm },
        data: { folderPageId: folderId },
      });
    } catch {
      // Best-effort per offering — skip on race/failure.
    }
  }

  // Archive the legacy loose folder once nothing else is filed in it.
  if (looseId) {
    const [childPages, remainingForms] = await Promise.all([
      prisma.page.count({ where: { parentPageId: looseId, archivedAt: null } }),
      prisma.form.count({ where: { folderPageId: looseId } }),
    ]);
    if (childPages === 0 && remainingForms === 0) {
      await prisma.page.update({ where: { id: looseId }, data: { archivedAt: new Date() } });
    }
  }
}

/**
 * The Hiring ▸ Application Templates subfolder — home for the hiring
 * application template Form (the source future cycle/challenge forms are cloned
 * from). Named "Application Templates" (not "Templates") to distinguish it from
 * Core ▸ Templates which holds EMAIL templates. Idempotent via systemKey.
 * Returns the folder's Page id.
 */
export async function ensureHiringTemplatesFolder(createdById: string): Promise<string> {
  const root = await ensureHiringDriveRoot(createdById);
  if (!root) throw new Error("Failed to ensure Hiring drive root");

  // Idempotent title fix: if this folder was previously created with the old
  // "Templates" title (before the rename), update it in-place so the Drive UI
  // shows the disambiguated name without requiring a new row.
  const existing = await prisma.page.findUnique({
    where: { systemKey: "drive:hiring-templates" },
    select: { id: true, title: true },
  });
  if (existing && existing.title === "Templates") {
    await prisma.page.update({
      where: { id: existing.id },
      data: { title: "Application Templates" },
    });
    return existing.id;
  }

  return ensureSystemChildFolder("drive:hiring-templates", root.id, "Application Templates", createdById);
}

export type MeetingNotesFolderKind = "Team" | "Partner";

const MEETING_NOTES_FOLDER_TITLE: Record<MeetingNotesFolderKind, string> = {
  Team: "Team meeting notes",
  Partner: "Partner meeting notes",
};

// Idempotently ensures a project's default "Team meeting notes" / "Partner
// meeting notes" folder exists, creating it (top-level, Folder-kind,
// systemKey-marked so api.documents.$id.ts refuses to delete it) on first
// call. Safe to call repeatedly — cheap enough to call from the Documents
// block loader so existing projects backfill their folders on first view
// rather than needing a separate migration script (same pattern as
// ensureProjectGroup in ~/lib/groups.ts).
export async function ensureMeetingNotesFolder(
  projectId: string,
  kind: MeetingNotesFolderKind,
  createdById: string,
): Promise<{ id: string }> {
  const systemKey = `project:${projectId}:${kind.toLowerCase()}-meeting-notes`;
  const existing = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
  if (existing) return existing;

  try {
    const last = await prisma.page.findFirst({
      where: { workspaceType: "Project", workspaceId: projectId, parentPageId: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = last ? last.position + 1 : 0;
    return await prisma.page.create({
      data: {
        workspaceType: "Project",
        workspaceId: projectId,
        title: MEETING_NOTES_FOLDER_TITLE[kind],
        kind: "Folder",
        position,
        createdById,
        systemKey,
      },
      select: { id: true },
    });
  } catch {
    // Unique-constraint race: another request created it concurrently.
    const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
    if (retry) return retry;
    throw new Error(`Failed to ensure meeting notes folder for project ${projectId}`);
  }
}

// The page behind a project's public write-up — the body dali.website renders
// under the showcase card. Created on demand from the Public view (not on
// mere page load: a project nobody intends to showcase shouldn't accrue an
// empty document), and marked publicVisible so the public API picks it up
// without a second step.
//
// It's an ordinary project page, so it also appears in the Documents block
// and can be edited from there. The systemKey both makes this ensure-create
// idempotent and stops api.documents.$id.ts deleting it out from under the
// public site.
export async function ensurePublicWriteupPage(
  projectId: string,
  createdById: string,
): Promise<{ id: string }> {
  // A team may already have nominated some other page via the Documents
  // globe toggle. Respect that rather than creating a second public page —
  // the public API takes the lowest-position publicVisible page, so creating
  // one here could silently outrank the page they chose.
  const existingPublic = await prisma.page.findFirst({
    where: {
      workspaceType: "Project",
      workspaceId: projectId,
      archivedAt: null,
      publicVisible: true,
    },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (existingPublic) return existingPublic;

  const systemKey = `project:${projectId}:public-writeup`;
  // Un-archive rather than duplicate: the systemKey is unique, so a
  // previously archived write-up would otherwise block creation forever.
  const existing = await prisma.page.findUnique({
    where: { systemKey },
    select: { id: true },
  });
  if (existing) {
    await prisma.page.update({
      where: { id: existing.id },
      data: { publicVisible: true, archivedAt: null },
    });
    return existing;
  }

  try {
    const last = await prisma.page.findFirst({
      where: { workspaceType: "Project", workspaceId: projectId, parentPageId: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return await prisma.page.create({
      data: {
        workspaceType: "Project",
        workspaceId: projectId,
        title: "Public write-up",
        kind: "FreeForm",
        position: last ? last.position + 1 : 0,
        createdById,
        systemKey,
        publicVisible: true,
      },
      select: { id: true },
    });
  } catch {
    // Unique-constraint race: another request created it concurrently.
    const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
    if (retry) return retry;
    throw new Error(`Failed to ensure public write-up page for project ${projectId}`);
  }
}
