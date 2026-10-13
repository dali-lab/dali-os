import { prisma } from "~/lib/db";
import { loadAncestorChain } from "~/lib/page-ancestry.server";
import { findReceiver, singletonSlot } from "~/lib/drive-receivers.server";
import { findRoot } from "~/lib/drive-roots.server";
import { CORE_PROCESS_ID } from "~/lib/bindings.server";

async function coreFolderIds(): Promise<Set<string>> {
  const [receiver, root, binding] = await Promise.all([
    findReceiver(singletonSlot("Core", "Meetings")),
    findRoot("core"),
    prisma.processFolderBinding.findUnique({
      where: {
        processType_processId_purpose: {
          processType: "Core",
          processId: CORE_PROCESS_ID,
          purpose: "meeting-notes",
        },
      },
      select: { folderPageId: true },
    }),
  ]);
  return new Set([receiver, root, binding?.folderPageId ?? null].filter((id): id is string => id !== null));
}

/**
 * Whether each notebook is Core's: the notebook, or a live shortcut to it,
 * sits in or under Core's Meetings folder or the Core root. Server-wide truth,
 * not viewer-scoped, so a shortcut the viewer can't see still counts.
 */
export async function coreByPlacementBulk(notebookIds: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>(notebookIds.map((id) => [id, false]));
  const unique = [...result.keys()];
  if (unique.length === 0) return result;

  const [core, notebooks, shortcuts] = await Promise.all([
    coreFolderIds(),
    prisma.page.findMany({
      where: { id: { in: unique }, archivedAt: null },
      select: { id: true, parentPageId: true },
    }),
    prisma.page.findMany({
      where: { kind: "Shortcut", targetPageId: { in: unique }, archivedAt: null },
      select: { targetPageId: true, parentPageId: true },
    }),
  ]);
  if (core.size === 0) return result;

  const folders = new Map<string, Set<string>>();
  const place = (notebookId: string | null, folderId: string | null) => {
    if (!notebookId || !folderId) return;
    const set = folders.get(notebookId) ?? new Set<string>();
    set.add(folderId);
    folders.set(notebookId, set);
  };
  for (const n of notebooks) place(n.id, n.parentPageId);
  for (const s of shortcuts) place(s.targetPageId, s.parentPageId);

  const underCore = new Map<string, boolean>();
  const folderIsCore = async (folderId: string): Promise<boolean> => {
    const known = underCore.get(folderId);
    if (known !== undefined) return known;
    const hit = core.has(folderId) || (await loadAncestorChain(folderId)).some((row) => core.has(row.id));
    underCore.set(folderId, hit);
    return hit;
  };

  for (const [notebookId, set] of folders) {
    for (const folderId of set) {
      if (await folderIsCore(folderId)) {
        result.set(notebookId, true);
        break;
      }
    }
  }
  return result;
}

export async function isCoreByPlacement(notebookId: string | null): Promise<boolean> {
  if (!notebookId) return false;
  return (await coreByPlacementBulk([notebookId])).get(notebookId) ?? false;
}

export type CoreMeetingFields = { isCoreMeeting: boolean; notebookId: string | null };

/** Placement decides once a meeting has a notebook; the legacy column only labels meetings with none. */
export async function isMeetingCore(meeting: CoreMeetingFields): Promise<boolean> {
  if (!meeting.notebookId) return meeting.isCoreMeeting;
  return isCoreByPlacement(meeting.notebookId);
}

/** `isMeetingCore` for many meetings at once, keyed by meeting id. */
export async function isMeetingCoreBulk(
  meetings: Array<CoreMeetingFields & { id: string }>,
): Promise<Map<string, boolean>> {
  const placement = await coreByPlacementBulk(
    meetings.map((m) => m.notebookId).filter((id): id is string => id !== null),
  );
  return new Map(
    meetings.map((m) => [m.id, m.notebookId ? (placement.get(m.notebookId) ?? false) : m.isCoreMeeting]),
  );
}
