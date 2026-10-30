import { prisma } from "~/lib/db.server";
import {
  CORE_PROCESS_ID,
  HIRING_PROCESS_ID,
  MENTORSHIP_PROCESS_ID,
} from "~/lib/process-ids";
import type { ProcessType, SharePermission } from "~/generated/prisma/client";
import { ensureMentorsGroup } from "~/lib/groups";

export type RootKey = "core" | "hiring" | "mentorship";

export type RootDef = {
  processType: ProcessType;
  processId: string;
  title: string;
  scopeGroupKey: "core" | "mentors";
  scopePermission: SharePermission;
  adoptLegacyShell: boolean;
};

export const ROOTS: Record<RootKey, RootDef> = {
  core: {
    processType: "Core",
    processId: CORE_PROCESS_ID,
    title: "Core",
    scopeGroupKey: "core",
    scopePermission: "Edit",
    adoptLegacyShell: true,
  },
  hiring: {
    processType: "HiringCycle",
    processId: HIRING_PROCESS_ID,
    title: "Hiring",
    scopeGroupKey: "core",
    scopePermission: "Edit",
    adoptLegacyShell: true,
  },
  mentorship: {
    processType: "Mentorship",
    processId: MENTORSHIP_PROCESS_ID,
    title: "Mentorship",
    scopeGroupKey: "mentors",
    scopePermission: "View",
    adoptLegacyShell: false,
  },
};

export const ROOT_KEYS = Object.keys(ROOTS) as RootKey[];

export { isRoot } from "~/lib/drive-roots";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

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
    if (def.adoptLegacyShell) {
      const adopted = await adoptLegacyShell(def, coreGroupId);
      if (adopted) return adopted;
    }

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

async function adoptLegacyShell(def: RootDef, coreGroupId: string): Promise<string | null> {
  const shell = await prisma.page.findFirst({
    where: {
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
      kind: "Folder",
      archivedAt: null,
      folderType: null,
      scopeKind: "Group",
      scopeGroupId: coreGroupId,
      title: { equals: def.title, mode: "insensitive" },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!shell) return null;
  await prisma.page.update({
    where: { id: shell.id },
    data: {
      folderType: "Root",
      processType: def.processType,
      processId: def.processId,
      linkAccess: "Restricted",
      linkPermission: "View",
    },
  });
  return shell.id;
}

export async function ensureAllRoots(createdById: string): Promise<Record<RootKey, string>> {
  const core = await ensureRoot("core", createdById);
  const hiring = await ensureRoot("hiring", createdById);
  const mentorship = await ensureRoot("mentorship", createdById);
  return { core, hiring, mentorship };
}
