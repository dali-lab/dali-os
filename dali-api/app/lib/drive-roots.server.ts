import { isUniqueViolation } from "~/lib/prisma-errors";
import { prisma } from "~/lib/db.server";
import {
  CORE_PROCESS_ID,
  HIRING_PROCESS_ID,
  MENTORSHIP_PROCESS_ID,
} from "~/lib/process-ids";
import type { ProcessType, SharePermission } from "~/generated/prisma/client";
import { ensureMentorsGroup } from "~/lib/groups";
import { getPageAccess } from "~/lib/pageAccess.server";
import { loadAncestorChain } from "~/lib/page-ancestry.server";
import { nearestRoot } from "~/lib/drive-roots";

export type RootKey = "core" | "hiring" | "mentorship";

export type RootDef = {
  processType: ProcessType;
  processId: string;
  title: string;
  scopeGroupKey: "core" | "mentors";
  scopePermission: SharePermission;
};

export const ROOTS: Record<RootKey, RootDef> = {
  core: {
    processType: "Core",
    processId: CORE_PROCESS_ID,
    title: "Core",
    scopeGroupKey: "core",
    scopePermission: "Edit",
  },
  hiring: {
    processType: "HiringCycle",
    processId: HIRING_PROCESS_ID,
    title: "Hiring",
    scopeGroupKey: "core",
    scopePermission: "Edit",
  },
  mentorship: {
    processType: "Mentorship",
    processId: MENTORSHIP_PROCESS_ID,
    title: "Mentorship",
    scopeGroupKey: "mentors",
    scopePermission: "View",
  },
};

export const ROOT_KEYS = Object.keys(ROOTS) as RootKey[];

export { isRoot } from "~/lib/drive-roots";

async function groupIdByKey(systemKey: string): Promise<string | null> {
  const group = await prisma.groupDefinition.findUnique({
    where: { systemKey },
    select: { id: true },
  });
  return group?.id ?? null;
}

export async function findRoot(key: RootKey): Promise<string | null> {
  const def = ROOTS[key];
  const page = await prisma.page.findFirst({
    where: {
      processType: def.processType,
      processId: def.processId,
      folderType: "Root",
      archivedAt: null,
    },
    select: { id: true },
  });
  return page?.id ?? null;
}

export function rootKeyFor(page: {
  processType?: string | null;
  processId?: string | null;
}): RootKey | null {
  return (
    ROOT_KEYS.find(
      (k) => ROOTS[k].processType === page.processType && ROOTS[k].processId === page.processId,
    ) ?? null
  );
}

export type LiveRoots = { byKey: Partial<Record<RootKey, string>>; ids: string[] };

export async function findAllRoots(): Promise<LiveRoots> {
  const rows = await prisma.page.findMany({
    where: { folderType: "Root", archivedAt: null },
    select: { id: true, processType: true, processId: true },
  });
  const byKey: Partial<Record<RootKey, string>> = {};
  for (const row of rows) {
    const key = rootKeyFor(row);
    if (key) byKey[key] = row.id;
  }
  return { byKey, ids: rows.map((r) => r.id) };
}

export async function ensureRoot(key: RootKey, createdById: string): Promise<string> {
  const existing = await findRoot(key);
  if (existing) return existing;

  const def = ROOTS[key];
  const coreGroupId = await groupIdByKey("core");
  if (!coreGroupId) throw new Error("The Core group is missing; cannot create a Drive root");
  let scopeGroupId = coreGroupId;
  if (def.scopeGroupKey === "mentors") {
    await ensureMentorsGroup();
    const mentorsGroupId = await groupIdByKey("mentors");
    if (!mentorsGroupId) throw new Error("The mentors group is missing; cannot create the Mentorship root");
    scopeGroupId = mentorsGroupId;
  }

  try {
    const last = await prisma.page.findFirst({
      where: { workspaceType: "Lab", workspaceId: null, parentPageId: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const created = await prisma.page.create({
      data: {
        workspaceType: "Lab",
        workspaceId: null,
        parentPageId: null,
        title: def.title,
        kind: "Folder",
        position: last ? last.position + 1 : 0,
        createdById,
        scopeKind: "Group",
        scopeGroupId,
        scopePermission: def.scopePermission,
        linkAccess: "Restricted",
        linkPermission: "View",
        folderType: "Root",
        processType: def.processType,
        processId: def.processId,
      },
      select: { id: true },
    });

    if (key === "mentorship") {
      await prisma.pageShare.upsert({
        where: {
          pageId_principalType_principalId: {
            pageId: created.id,
            principalType: "Group",
            principalId: coreGroupId,
          },
        },
        update: { permission: "Edit" },
        create: {
          pageId: created.id,
          principalType: "Group",
          principalId: coreGroupId,
          permission: "Edit",
          createdById,
        },
      });
    }
    return created.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await findRoot(key);
    if (raced) return raced;
    throw err;
  }
}

export async function ensureAllRoots(createdById: string): Promise<Record<RootKey, string>> {
  const core = await ensureRoot("core", createdById);
  const hiring = await ensureRoot("hiring", createdById);
  const mentorship = await ensureRoot("mentorship", createdById);
  return { core, hiring, mentorship };
}

/** The folder a new item may be created in: `folderPageId` when it's a live folder the user can edit under this root, else null. */
export async function editableFolderInRoot(
  userId: string,
  folderPageId: string | null,
  key: RootKey,
  request?: Request,
): Promise<string | null> {
  if (!folderPageId) return null;
  const [chain, rootId] = await Promise.all([loadAncestorChain(folderPageId), findRoot(key)]);
  const folder = chain[0];
  if (!folder || folder.kind !== "Folder" || folder.archivedAt !== null) return null;
  if (!rootId || nearestRoot(chain)?.id !== rootId) return null;
  return (await getPageAccess(userId, folderPageId, request)).canEdit ? folderPageId : null;
}
