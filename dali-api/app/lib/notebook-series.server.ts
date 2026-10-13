import { prisma } from "~/lib/db";
import { expandOccurrences, nextOpenOccurrence } from "~/lib/meeting-occurrences";

const LOOKAHEAD_MS = 120 * 24 * 60 * 60_000;

/**
 * The meeting occurrence a notebook's "Add note" should open: the first
 * upcoming one with no note, for the series that files into the notebook (else
 * the series one of its notes belongs to). Null when the notebook has no
 * series, or every upcoming occurrence already has its note.
 */
export async function nextNoteTarget(
  notebookId: string,
  now: Date = new Date(),
): Promise<{ meetingId: string; occurrenceStart: string } | null> {
  const meetingSelect = {
    id: true,
    selectedAt: true,
    durationMinutes: true,
    recurrenceRule: true,
    exceptions: {
      select: { originalStart: true, overrideStart: true, overrideDurationMin: true, cancelled: true },
    },
    notePages: { select: { meetingOccurrenceStart: true } },
  } as const;
  const series =
    (await prisma.scheduledMeeting.findFirst({
      where: { notebookId, status: { not: "Cancelled" } },
      select: meetingSelect,
    })) ??
    (
      await prisma.page.findFirst({
        where: { parentPageId: notebookId, archivedAt: null, meetingNoteId: { not: null }, meetingNote: { status: { not: "Cancelled" } } },
        orderBy: { meetingOccurrenceStart: "desc" },
        select: { meetingNote: { select: meetingSelect } },
      })
    )?.meetingNote ??
    null;
  if (!series?.selectedAt) return null;

  const occurrences = expandOccurrences(series, series.exceptions, new Date(now.getTime() - 24 * 60 * 60_000), new Date(now.getTime() + LOOKAHEAD_MS));
  const next = nextOpenOccurrence(occurrences, series.notePages, now);
  return next ? { meetingId: series.id, occurrenceStart: next.originalStart.toISOString() } : null;
}
