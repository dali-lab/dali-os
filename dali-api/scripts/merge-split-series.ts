/**
 * Fold the DALI row of a Google "this and following" split back into the
 * meeting it split from.
 *
 * People tracked a split series (`<base>_R<stamp>`) before DALI matched splits
 * to their original, leaving two live ScheduledMeetings with notes, attendance,
 * recordings and time entries divided between them. When every key the split
 * holds data at is an occurrence of the parent's rule, the split's data moves
 * onto the parent and the split row is Cancelled (no Google calls, no
 * notifications). A split whose times differ from the parent's needs a
 * continuation row and is reported and skipped. Notes are never deleted or
 * archived; a conflicting note is detached and stays where it is.
 *
 * Dry run by default; one transaction per (parent, split) pair with --commit.
 *
 * Usage:
 *   npx tsx scripts/merge-split-series.ts            # dry run
 *   npx tsx scripts/merge-split-series.ts --commit   # apply
 *
 * Needs DATABASE_URL from prod.
 */

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { formatPairPlan, isSplitId, planSplitFolds } from "../app/lib/split-series-fold";
import type { FoldMeeting, FoldMeetingData, PairPlan } from "../app/lib/split-series-fold";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function loadData(ids: string[]): Promise<Map<string, FoldMeetingData>> {
  const [notes, attendance, recordings, timeEntries, exceptions] = await Promise.all([
    prisma.page.findMany({
      where: { meetingNoteId: { in: ids } },
      select: { id: true, meetingNoteId: true, meetingOccurrenceStart: true, archivedAt: true, parentPageId: true },
    }),
    prisma.meetingAttendance.findMany({ where: { scheduledMeetingId: { in: ids } } }),
    prisma.meetingRecording.findMany({
      where: { scheduledMeetingId: { in: ids } },
      select: { id: true, scheduledMeetingId: true, occurrenceStart: true },
    }),
    prisma.timeEntry.findMany({
      where: { scheduledMeetingId: { in: ids } },
      select: { id: true, userId: true, scheduledMeetingId: true, occurrenceStart: true },
    }),
    prisma.meetingException.findMany({ where: { scheduledMeetingId: { in: ids } } }),
  ]);

  const data = new Map<string, FoldMeetingData>(
    ids.map((id) => [id, { notes: [], attendance: [], recordings: [], timeEntries: [], exceptions: [] }]),
  );
  for (const n of notes) {
    data.get(n.meetingNoteId!)!.notes.push({
      id: n.id,
      key: n.meetingOccurrenceStart,
      archived: n.archivedAt !== null,
      parentPageId: n.parentPageId,
    });
  }
  for (const a of attendance) {
    data.get(a.scheduledMeetingId)!.attendance.push({
      id: a.id,
      userId: a.userId,
      key: a.occurrenceStart,
      present: a.present,
      markedAt: a.markedAt,
      markedByUserId: a.markedByUserId,
      absenceNote: a.absenceNote,
    });
  }
  for (const r of recordings) {
    data.get(r.scheduledMeetingId!)!.recordings.push({ id: r.id, key: r.occurrenceStart });
  }
  for (const t of timeEntries) {
    data.get(t.scheduledMeetingId!)!.timeEntries.push({ id: t.id, userId: t.userId, key: t.occurrenceStart });
  }
  for (const e of exceptions) {
    data.get(e.scheduledMeetingId)!.exceptions.push({
      originalStart: e.originalStart,
      overrideStart: e.overrideStart,
      overrideDurationMin: e.overrideDurationMin,
      cancelled: e.cancelled,
    });
  }
  return data;
}

async function apply(p: PairPlan): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ids = (items: { pageId: string }[]) => items.map((i) => i.pageId);
    if (p.parentArchivedDetaches.length > 0) {
      await tx.page.updateMany({
        where: { id: { in: ids(p.parentArchivedDetaches) } },
        data: { meetingNoteId: null },
      });
    }
    if (p.noteDetaches.length > 0) {
      await tx.page.updateMany({
        where: { id: { in: ids(p.noteDetaches) } },
        data: { meetingNoteId: null, meetingOccurrenceStart: null },
      });
    }
    if (p.noteMoves.length > 0) {
      await tx.page.updateMany({ where: { id: { in: ids(p.noteMoves) } }, data: { meetingNoteId: p.parentId } });
    }
    if (p.attendanceMoves.length > 0) {
      await tx.meetingAttendance.updateMany({
        where: { id: { in: p.attendanceMoves } },
        data: { scheduledMeetingId: p.parentId },
      });
    }
    for (const m of p.attendanceMerges) {
      if (Object.keys(m.set).length > 0) await tx.meetingAttendance.update({ where: { id: m.parentRowId }, data: m.set });
    }
    if (p.attendanceMerges.length > 0) {
      await tx.meetingAttendance.deleteMany({ where: { id: { in: p.attendanceMerges.map((m) => m.splitRowId) } } });
    }
    if (p.recordingMoves.length > 0) {
      await tx.meetingRecording.updateMany({
        where: { id: { in: p.recordingMoves } },
        data: { scheduledMeetingId: p.parentId },
      });
    }
    if (p.timeEntryMoves.length > 0) {
      await tx.timeEntry.updateMany({
        where: { id: { in: p.timeEntryMoves } },
        data: { scheduledMeetingId: p.parentId },
      });
    }
    await tx.scheduledMeeting.update({
      where: { id: p.parentId },
      data: {
        ...(p.parentNotebookId ? { notebookId: p.parentNotebookId } : {}),
        ...(p.participantUserIds ? { participantUserIds: p.participantUserIds } : {}),
      },
    });
    await tx.scheduledMeeting.update({ where: { id: p.splitId }, data: { status: "Cancelled" } });
  });
}

async function main() {
  const commit = process.argv.includes("--commit");

  const meetings: FoldMeeting[] = await prisma.scheduledMeeting.findMany({
    where: { status: { not: "Cancelled" }, OR: [{ externalEventId: { not: null } }, { iCalUID: { not: null } }] },
    select: {
      id: true,
      title: true,
      externalEventId: true,
      iCalUID: true,
      status: true,
      createdAt: true,
      selectedAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      notebookId: true,
      participantUserIds: true,
    },
  });

  const splitCount = meetings.filter((m) => isSplitId(m.externalEventId)).length;
  console.log(`${meetings.length} live Google-linked meeting(s), ${splitCount} split row(s).`);

  const probe = planSplitFolds(meetings, new Map());
  const involved = [...new Set([...probe.pairs.flatMap((p) => [p.parentId, p.splitId])])];
  const plan = planSplitFolds(meetings, await loadData(involved));

  for (const o of plan.orphans) {
    console.log(`\n${o.title} (${o.splitId}, ${o.externalEventId})\n  ${o.reason}`);
  }

  let folded = 0;
  let skipped = plan.orphans.length;
  let failed = 0;
  for (const p of plan.pairs) {
    console.log(`\n${formatPairPlan(p)}`);
    if (p.skipReason) {
      skipped++;
      continue;
    }
    if (!commit) {
      folded++;
      continue;
    }
    try {
      await apply(p);
      const { moveIntoNotebook } = await import("../app/lib/pages");
      for (const m of p.notebookMoves) {
        try {
          await moveIntoNotebook(m.pageId, m.notebookId);
        } catch (err) {
          console.warn(`  could not refile ${m.pageId} into ${m.notebookId}: ${err instanceof Error ? err.message : err}`);
        }
      }
      const { syncMeetingShares } = await import("../app/lib/meeting-shares.server");
      await syncMeetingShares(p.parentId);
      folded++;
    } catch (err) {
      failed++;
      console.error(`  FAILED, pair rolled back: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `\n${commit ? "Folded" : "Would fold"} ${folded}, skipped ${skipped}, failed ${failed}.` +
      (commit ? "" : " Dry run; pass --commit to apply."),
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
