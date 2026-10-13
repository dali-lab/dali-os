import { prisma } from "~/lib/db";
import { resolveCoreActor } from "~/jobs/core-actor.server";
import { coreByPlacementBulk } from "~/lib/core-meeting.server";
import { resolveFilingFolder, singletonSlot } from "~/lib/drive-receivers.server";
import { createShortcut, ShortcutError } from "~/lib/shortcuts.server";
import type { JobResult } from "~/jobs/registry";

export const CORE_FLAG_BATCH = 200;
const SCAN_CHUNK = 200;

/**
 * Gives every notebook of a meeting flagged Core a shortcut in Core's Meetings
 * folder, so the flag's meaning survives as a placement. One batch per tick;
 * the interval repeats it until none are left.
 */
export async function runCoreFlagToShortcuts(): Promise<JobResult> {
  const resolved = await resolveCoreActor();
  if ("abort" in resolved) {
    console.warn(`core-flag-to-shortcuts aborted: ${resolved.abort}`);
    return { items: 0, note: `Aborted: ${resolved.abort}` };
  }
  const { folderId } = await resolveFilingFolder(singletonSlot("Core", "Meetings"), resolved.actorId);
  if (!folderId) return { items: 0, note: "Aborted: Core has no Meetings folder or root" };
  const dest = { workspaceType: "Lab" as const, workspaceId: null, parentPageId: folderId };

  const flagged = await prisma.scheduledMeeting.findMany({
    where: { isCoreMeeting: true, notebook: { is: { kind: "Notebook", archivedAt: null } } },
    distinct: ["notebookId"],
    orderBy: [{ notebookId: "asc" }, { createdAt: "asc" }],
    select: { notebookId: true, organizerId: true },
  });
  const organizerByNotebook = new Map<string, string>();
  for (const m of flagged) if (m.notebookId) organizerByNotebook.set(m.notebookId, m.organizerId);

  const pending: string[] = [];
  const notebookIds = [...organizerByNotebook.keys()];
  for (let i = 0; i < notebookIds.length; i += SCAN_CHUNK) {
    const chunk = notebookIds.slice(i, i + SCAN_CHUNK);
    const placed = await coreByPlacementBulk(chunk);
    for (const id of chunk) if (!placed.get(id)) pending.push(id);
  }

  let linked = 0;
  let declined = 0;
  for (const notebookId of pending.slice(0, CORE_FLAG_BATCH)) {
    const actors = [organizerByNotebook.get(notebookId)!, resolved.actorId];
    let done = false;
    for (const actorId of actors) {
      try {
        await createShortcut({ targetPageId: notebookId, dest, actorId });
        done = true;
        break;
      } catch (err) {
        if (!(err instanceof ShortcutError)) {
          console.error(`core-flag-to-shortcuts: notebook ${notebookId} skipped`, err);
          break;
        }
      }
    }
    if (done) linked++;
    else declined++;
  }

  const note = `linked ${linked}, declined ${declined}, remaining ${pending.length - linked}`;
  console.log(`core-flag-to-shortcuts: ${note}`);
  return { items: linked, note };
}
