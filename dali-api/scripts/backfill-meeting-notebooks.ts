/**
 * File existing meeting notes into notebooks. A meeting note used to be its own
 * Drive document, one per meeting occurrence; notes are now tabs of a notebook
 * (see app/lib/meeting-notebook.ts): one "Team meeting note <term>" and one
 * "Partner meeting note <term>" per project per term, and one per audience for
 * every other meeting. New notes file that way on creation; this is the one-off
 * pass for the notes that already exist.
 *
 * Each notebook is created where its earliest note sits today (for a project's
 * Team/Partner notes, the project's meeting-notes folder), and the notes keep
 * their bodies, titles, comments and attendance. Only where they are filed
 * changes.
 *
 * Scoped to live note pages in the Lab or a project that aren't in a notebook
 * yet. Idempotent, so re-runs are safe.
 *
 * Dry-run by default.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-meeting-notebooks.ts           # dry run
 *   npx tsx --env-file .env scripts/backfill-meeting-notebooks.ts --commit  # write to DB
 */

import { prisma } from "../app/lib/db.js";
import { ensureMeetingNotebook, moveIntoNotebook } from "../app/lib/pages.js";
import { meetingNotebookIdentity, termForDate } from "../app/lib/meeting-notebook.js";
import { termWindows } from "../app/lib/terms.js";

const commit = process.argv.includes("--commit");

async function main() {
  const windows = await termWindows();
  const notes = await prisma.page.findMany({
    where: {
      meetingNoteId: { not: null },
      kind: "FreeForm",
      archivedAt: null,
      workspaceType: { in: ["Lab", "Project"] },
      NOT: { parent: { is: { notebookKey: { not: null } } } },
    },
    orderBy: { meetingOccurrenceStart: "asc" },
    select: {
      id: true,
      title: true,
      workspaceType: true,
      workspaceId: true,
      parentPageId: true,
      linkAccess: true,
      createdById: true,
      createdAt: true,
      meetingOccurrenceStart: true,
      meetingNote: {
        select: {
          title: true,
          meetingType: true,
          meetingTypeLabel: true,
          projectId: true,
          isCoreMeeting: true,
          scopeType: true,
          scopeId: true,
          organizerId: true,
          participantUserIds: true,
          guestEmails: true,
          selectedAt: true,
        },
      },
    },
  });

  console.log(`Found ${notes.length} meeting note(s) outside a notebook.`);

  const notebooks = new Map<string, { title: string; count: number }>();
  let skipped = 0;
  for (const note of notes) {
    const meeting = note.meetingNote;
    if (!meeting?.meetingType) {
      skipped++;
      console.log(`[SKIP] "${note.title}" (${note.id}): its meeting has no type`);
      continue;
    }
    const date = note.meetingOccurrenceStart ?? meeting.selectedAt ?? note.createdAt;
    const identity = meetingNotebookIdentity(
      { ...meeting, meetingType: meeting.meetingType },
      termForDate(windows, date),
    );
    const seen = notebooks.get(identity.key);
    if (seen) seen.count++;
    else notebooks.set(identity.key, { title: identity.title, count: 1 });
    console.log(`[${commit ? "WRITE" : "DRY"}] "${note.title}" (${note.id}) -> "${identity.title}"`);

    if (commit) {
      const notebook = await ensureMeetingNotebook({
        ...identity,
        createdById: note.createdById,
        workspaceType: note.workspaceType === "Project" ? "Project" : "Lab",
        workspaceId: note.workspaceId,
        parentPageId: note.parentPageId,
        restricted: note.linkAccess === "Restricted",
      });
      await moveIntoNotebook(note.id, notebook.id);
    }
  }

  console.log(
    `\n${commit ? "Filed" : "Would file"} ${notes.length - skipped} note(s) into ${notebooks.size} notebook(s); skipped ${skipped}.`,
  );
  for (const { title, count } of notebooks.values()) console.log(`  ${title}: ${count}`);
  if (!commit) console.log("Dry run. Re-run with --commit to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
