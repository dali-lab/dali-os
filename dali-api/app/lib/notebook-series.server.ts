import { prisma } from "~/lib/db.server";
import { expandOccurrences, nextOpenOccurrence } from "~/lib/meeting-occurrences";

const LOOKAHEAD_MS = 120 * 24 * 60 * 60_000;

export type NextNoteTarget = { meetingId: string; meetingTitle: string; occurrenceStart: string };

/**
 * The occurrences a notebook's "Add note" can open: for every series that files
 * into the notebook, or that one of its notes belongs to, the first upcoming
 * occurrence with no note. A series with none is left out. Recurring series
 * come before one-offs, each group by occurrence start.
 */
export async function nextNoteTargets(notebookId: string, now: Date = new Date()): Promise<NextNoteTarget[]> {
  const meetingSelect = {
    id: true,
    title: true,
    selectedAt: true,
    durationMinutes: true,
    recurrenceRule: true,
    exceptions: {
      select: { originalStart: true, overrideStart: true, overrideDurationMin: true, cancelled: true },
    },
    notePages: { select: { meetingOccurrenceStart: true } },
  } as const;
  const [filing, tabs] = await Promise.all([
    prisma.scheduledMeeting.findMany({
      where: { notebookId, status: { not: "Cancelled" } },
      select: meetingSelect,
    }),
    prisma.page.findMany({
      where: { parentPageId: notebookId, archivedAt: null, meetingNoteId: { not: null }, meetingNote: { status: { not: "Cancelled" } } },
      select: { meetingNote: { select: meetingSelect } },
    }),
  ]);
  const byId = new Map<string, (typeof filing)[number]>();
  for (const m of [...filing, ...tabs.flatMap((t) => (t.meetingNote ? [t.meetingNote] : []))]) {
    if (!byId.has(m.id)) byId.set(m.id, m);
  }

  const from = new Date(now.getTime() - 24 * 60 * 60_000);
  const to = new Date(now.getTime() + LOOKAHEAD_MS);
  const targets = [...byId.values()].flatMap((series) => {
    if (!series.selectedAt) return [];
    const next = nextOpenOccurrence(expandOccurrences(series, series.exceptions, from, to), series.notePages, now);
    return next
      ? [{ meetingId: series.id, meetingTitle: series.title, occurrenceStart: next.originalStart, recurring: series.recurrenceRule !== null }]
      : [];
  });
  return targets
    .sort((a, b) => Number(b.recurring) - Number(a.recurring) || a.occurrenceStart.getTime() - b.occurrenceStart.getTime())
    .map((t) => ({ meetingId: t.meetingId, meetingTitle: t.meetingTitle, occurrenceStart: t.occurrenceStart.toISOString() }));
}
