import { prisma } from "~/lib/db.server";
import { resolveCoreActor } from "~/jobs/core-actor.server";
import { ensureMentorNotePage } from "~/mentorship/lib/pair-notebook.server";
import type { JobResult } from "~/jobs/registry";

export const MENTOR_NOTE_BATCH = 200;

/** One batch per tick keeps the work well under the job lease; the interval repeats it until none are left. */
export async function runMentorNotesToNotebooks(): Promise<JobResult> {
  const resolved = await resolveCoreActor();
  if ("abort" in resolved) {
    console.warn(`mentor-notes-to-notebooks aborted: ${resolved.abort}`);
    return { items: 0, note: `Aborted: ${resolved.abort}` };
  }

  const batch = await prisma.mentorNote.findMany({
    where: { pageId: null },
    orderBy: { createdAt: "asc" },
    take: MENTOR_NOTE_BATCH,
    select: {
      id: true,
      mentorId: true,
      menteeId: true,
      projectId: true,
      termId: true,
      domainId: true,
      weekOf: true,
      pageId: true,
      contentJson: true,
    },
  });

  let migrated = 0;
  let skipped = 0;
  for (const note of batch) {
    try {
      await ensureMentorNotePage(note, resolved.actorId);
      migrated++;
    } catch (err) {
      console.error(`mentor-notes-to-notebooks: note ${note.id} skipped`, err);
      skipped++;
    }
  }

  const remaining = await prisma.mentorNote.count({ where: { pageId: null } });
  const note = `migrated ${migrated}, skipped ${skipped}, remaining ${remaining}`;
  console.log(`mentor-notes-to-notebooks: ${note}`);
  return { items: migrated, note };
}
