import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { MAX_PAGE_DEPTH } from "~/lib/pages";
import { ensureRoot, rootKeyFor, type RootKey } from "~/lib/drive-roots.server";
import { CLEARED_FOLDER_TYPE } from "~/lib/drive-roots";
import {
  CORE_PROCESS_ID,
  HIRING_PROCESS_ID,
  LAB_PROCESS_ID,
  MENTORSHIP_PROCESS_ID,
} from "~/lib/bindings.server";
import {
  RECEIVER_LABELS,
  RECEIVER_SLOTS,
  type ReceiverFolderType,
  type ReceiverProcessType,
} from "~/lib/drive-receivers";
import type { FolderType, ProcessType } from "~/generated/prisma/client";

export { RECEIVER_LABELS, RECEIVER_SLOTS, type ReceiverFolderType, type ReceiverProcessType };

export type ReceiverSlot = {
  processType: ProcessType;
  processId: string;
  folderType: ReceiverFolderType;
};

export class ReceiverError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
    this.name = "ReceiverError";
  }
}

export function isReceiverProcessType(value: string): value is ReceiverProcessType {
  return Object.prototype.hasOwnProperty.call(RECEIVER_SLOTS, value);
}

export function isReceiverFolderType(value: string): value is ReceiverFolderType {
  return Object.prototype.hasOwnProperty.call(RECEIVER_LABELS, value);
}

export function acceptsReceiver(processType: string, folderType: string): boolean {
  return isReceiverProcessType(processType) && (RECEIVER_SLOTS[processType] as readonly string[]).includes(folderType);
}

export function receiverProcessId(processType: ReceiverProcessType, rawId?: string | null): string {
  switch (processType) {
    case "Core":
      return CORE_PROCESS_ID;
    case "HiringCycle":
      return HIRING_PROCESS_ID;
    case "Mentorship":
      return MENTORSHIP_PROCESS_ID;
    case "Lab":
      return LAB_PROCESS_ID;
    case "Project":
      return rawId ?? "";
  }
}

export function singletonSlot(
  processType: Exclude<ReceiverProcessType, "Project">,
  folderType: ReceiverFolderType,
): ReceiverSlot {
  return { processType, processId: receiverProcessId(processType), folderType };
}

export function projectSlot(projectId: string, folderType: ReceiverFolderType = "Meetings"): ReceiverSlot {
  return { processType: "Project", processId: projectId, folderType };
}

const ROOT_KEY_FOR_PROCESS: Partial<Record<ProcessType, RootKey>> = {
  Core: "core",
  HiringCycle: "hiring",
  Mentorship: "mentorship",
};

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

function sameSlot(a: ReceiverSlot, b: ReceiverSlot): boolean {
  return a.processType === b.processType && a.processId === b.processId && a.folderType === b.folderType;
}

function slotLabel(slot: ReceiverSlot): string {
  return RECEIVER_LABELS[slot.folderType].toLowerCase();
}

type ChainPage = {
  id: string;
  title: string;
  kind: string;
  archivedAt: Date | null;
  parentPageId: string | null;
  workspaceType: string;
  workspaceId: string | null;
  folderType: FolderType | null;
  processType: ProcessType | null;
  processId: string | null;
};

const CHAIN_SELECT = {
  id: true,
  title: true,
  kind: true,
  archivedAt: true,
  parentPageId: true,
  workspaceType: true,
  workspaceId: true,
  folderType: true,
  processType: true,
  processId: true,
} as const;

/** The page itself, then each ancestor up to the top, bounded so a cyclic or broken chain ends. */
async function loadChain(pageId: string): Promise<ChainPage[]> {
  const chain: ChainPage[] = [];
  let id: string | null = pageId;
  while (id !== null && chain.length <= MAX_PAGE_DEPTH + 2) {
    const row: ChainPage | null = await prisma.page.findUnique({ where: { id }, select: CHAIN_SELECT });
    if (!row) break;
    chain.push(row);
    id = row.parentPageId;
  }
  return chain;
}

export async function folderPath(folderId: string): Promise<Array<{ id: string; title: string }>> {
  const chain = await loadChain(folderId);
  return chain.reverse().map((p) => ({ id: p.id, title: p.title }));
}

export async function findReceiver(slot: ReceiverSlot): Promise<string | null> {
  const page = await prisma.page.findFirst({
    where: {
      processType: slot.processType,
      processId: slot.processId,
      folderType: slot.folderType,
      archivedAt: null,
    },
    select: { id: true },
  });
  return page?.id ?? null;
}

function chainIsUnderRoot(chain: ChainPage[], slot: Pick<ReceiverSlot, "processType" | "processId">): boolean {
  const [folder, ...ancestors] = chain;
  if (!folder) return false;
  const rootKey = ROOT_KEY_FOR_PROCESS[slot.processType];
  if (rootKey) {
    return ancestors.some((a) => a.folderType === "Root" && rootKeyFor(a) === rootKey);
  }
  if (slot.processType === "Project") {
    return folder.workspaceType === "Project" && folder.workspaceId === slot.processId;
  }
  if (slot.processType === "Lab") {
    return (
      folder.workspaceType === "Lab" && folder.workspaceId === null && !ancestors.some((a) => a.folderType === "Root")
    );
  }
  return false;
}

export async function isUnderRoot(
  folderId: string,
  slot: Pick<ReceiverSlot, "processType" | "processId">,
): Promise<boolean> {
  return chainIsUnderRoot(await loadChain(folderId), slot);
}

async function loadLiveFolder(folderId: string): Promise<ChainPage> {
  const folder = await prisma.page.findUnique({ where: { id: folderId }, select: CHAIN_SELECT });
  if (!folder || folder.archivedAt !== null || folder.kind !== "Folder") {
    throw new ReceiverError("Choose a folder that is not in the trash");
  }
  if (folder.folderType === "Root") {
    throw new ReceiverError("A Drive root can't also be a receiver");
  }
  return folder;
}

export async function setReceiver(slot: ReceiverSlot, folderId: string, actorId: string): Promise<void> {
  if (!acceptsReceiver(slot.processType, slot.folderType)) {
    throw new ReceiverError("This process doesn't take that kind of folder");
  }
  const folder = await loadLiveFolder(folderId);

  if (folder.folderType && folder.folderType !== "Root") {
    const typed: ReceiverFolderType = folder.folderType;
    const current: ReceiverSlot | null =
      folder.processType && folder.processId
        ? { processType: folder.processType, processId: folder.processId, folderType: typed }
        : null;
    if (current && sameSlot(current, slot)) return;
    if (current) {
      throw new ReceiverError(
        `This folder already receives ${slotLabel(current)}. Clear that first.`,
        409,
      );
    }
    if (typed !== slot.folderType) {
      throw new ReceiverError(`This folder is marked for ${RECEIVER_LABELS[typed].toLowerCase()}. Clear that first.`, 409);
    }
  }

  const chain = await loadChain(folderId);
  if (!chainIsUnderRoot(chain, slot)) {
    throw new ReceiverError("A receiver has to live inside the folder tree it files for");
  }

  let previousId: string | null = null;
  try {
    previousId = await prisma.$transaction(async (tx) => {
      const previous = await tx.page.findFirst({
        where: {
          processType: slot.processType,
          processId: slot.processId,
          folderType: slot.folderType,
          archivedAt: null,
          id: { not: folderId },
        },
        select: { id: true },
      });
      if (previous) {
        await tx.page.update({
          where: { id: previous.id },
          data: CLEARED_FOLDER_TYPE,
        });
      }
      await tx.page.update({
        where: { id: folderId },
        data: { folderType: slot.folderType, processType: slot.processType, processId: slot.processId },
      });
      return previous?.id ?? null;
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await findReceiver(slot);
    throw new ReceiverError(
      winner && winner !== folderId
        ? `Someone just chose a different folder for ${slotLabel(slot)}. Reload and try again.`
        : "That change collided with another one. Try again.",
      409,
    );
  }

  await logAuditEvent({
    action: "page.receiver",
    userId: actorId,
    targetId: folderId,
    metadata: { op: "set", ...slot, previousFolderId: previousId },
  });
}

export async function clearReceiver(slot: ReceiverSlot, actorId: string): Promise<string | null> {
  const current = await findReceiver(slot);
  if (!current) return null;
  await prisma.page.update({
    where: { id: current },
    data: CLEARED_FOLDER_TYPE,
  });
  await logAuditEvent({
    action: "page.receiver",
    userId: actorId,
    targetId: current,
    metadata: { op: "clear", ...slot },
  });
  return current;
}

export async function setFolderHint(folderId: string, hint: "Meetings" | null, actorId: string): Promise<void> {
  const folder = await loadLiveFolder(folderId);
  if (folder.processType !== null) {
    throw new ReceiverError("This folder already receives filed items, so it can't also be a hint", 409);
  }
  await prisma.page.update({ where: { id: folderId }, data: { folderType: hint } });
  await logAuditEvent({
    action: "page.receiver",
    userId: actorId,
    targetId: folderId,
    metadata: { op: "hint", hint },
  });
}

/** Called after a move: a receiver that left the tree it files for goes back to being a plain folder. */
export async function clearTypeIfLeavingRoot(pageIds: string[]): Promise<string[]> {
  if (pageIds.length === 0) return [];
  const typed = await prisma.page.findMany({
    where: {
      id: { in: pageIds },
      kind: "Folder",
      archivedAt: null,
      folderType: { not: null },
      NOT: { folderType: "Root" },
      processType: { not: null },
    },
    select: { id: true, processType: true, processId: true },
  });
  const leaving: string[] = [];
  for (const folder of typed) {
    if (!folder.processType || !folder.processId) continue;
    if (!(await isUnderRoot(folder.id, { processType: folder.processType, processId: folder.processId }))) {
      leaving.push(folder.id);
    }
  }
  if (leaving.length > 0) {
    await prisma.page.updateMany({
      where: { id: { in: leaving } },
      data: CLEARED_FOLDER_TYPE,
    });
  }
  return leaving;
}

export async function resolveFilingFolder(
  slot: ReceiverSlot,
  actorId: string,
): Promise<{ folderId: string | null; viaReceiver: boolean }> {
  const receiver = await findReceiver(slot);
  if (receiver) return { folderId: receiver, viaReceiver: true };
  const rootKey = ROOT_KEY_FOR_PROCESS[slot.processType];
  if (!rootKey) return { folderId: null, viaReceiver: false };
  return { folderId: await ensureRoot(rootKey, actorId), viaReceiver: false };
}

export async function receiversEnabled(request?: Request): Promise<boolean> {
  return isFeatureEnabledForEveryone("drive-receivers", request);
}

/** The folder a feature files into: receiver-else-root behind the flag, the caller's old path otherwise. */
export async function filingFolderOr(
  slot: ReceiverSlot,
  actorId: string,
  legacy: () => Promise<string | null>,
  request?: Request,
): Promise<string | null> {
  if (!(await receiversEnabled(request))) return legacy();
  return (await resolveFilingFolder(slot, actorId)).folderId;
}
