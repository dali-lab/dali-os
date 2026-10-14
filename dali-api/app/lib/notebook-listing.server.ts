import { prisma } from "~/lib/db";
import { getPageAccessBulk, PAGE_ACCESS_SELECT } from "~/lib/pageAccess.server";
import { meetingNotebookIdentity, type NotebookMeeting } from "~/lib/meeting-notebook";
import { suggestNotebooks, type NotebookCandidate } from "~/lib/notebook-suggest";
import { formatFiledPath, notebookLocationPartsBulk } from "~/lib/note-path.server";

// The notebooks the picker offers: ones the viewer can edit, in any workspace
// they belong to, with the signals that make some of them suggested.

const MAX_SCANNED = 300;
export const MAX_LISTED = 50;

const meetingIdentitySelect = {
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
} as const;

type IdentityRow = Omit<NotebookMeeting, "meetingType"> & { meetingType: NotebookMeeting["meetingType"] | null };

function audienceKeyOf(m: IdentityRow): string {
  return meetingNotebookIdentity({ ...m, meetingType: m.meetingType ?? "Other" }, null).key;
}

export type ListedNotebook = {
  id: string;
  title: string;
  path: string;
  workspaceType: string;
  workspaceId: string | null;
  parentPageId: string | null;
  tabCount: number;
  lastNoteAt: string | null;
  suggested: boolean;
};

export async function listNotebooks(input: {
  actorId: string;
  q?: string | null;
  projectId?: string | null;
  meetingId?: string | null;
  request?: Request;
}): Promise<ListedNotebook[]> {
  const q = input.q?.trim();
  const rows = await prisma.page.findMany({
    where: { kind: "Notebook", archivedAt: null, ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: MAX_SCANNED,
    select: { ...PAGE_ACCESS_SELECT, title: true, notebookKey: true },
  });
  const access = await getPageAccessBulk(input.actorId, rows, input.request);
  const editable = rows.filter((r) => access.get(r.id)?.canEdit);
  if (editable.length === 0) return [];
  const ids = editable.map((r) => r.id);

  const meetingId = input.meetingId ?? null;
  const [stats, seriesUsing, tabNotes, meeting] = await Promise.all([
    prisma.page.groupBy({
      by: ["parentPageId"],
      where: { parentPageId: { in: ids }, archivedAt: null },
      _count: { _all: true },
      _max: { meetingOccurrenceStart: true, createdAt: true },
    }),
    meetingId
      ? prisma.scheduledMeeting.findMany({
          where: { notebookId: { in: ids } },
          select: { notebookId: true, ...meetingIdentitySelect },
        })
      : [],
    meetingId
      ? prisma.page.findMany({
          where: { parentPageId: { in: ids }, archivedAt: null, meetingNoteId: { not: null } },
          select: { parentPageId: true, meetingNoteId: true, meetingNote: { select: meetingIdentitySelect } },
        })
      : [],
    meetingId
      ? prisma.scheduledMeeting.findUnique({
          where: { id: meetingId },
          select: { notebookId: true, ...meetingIdentitySelect },
        })
      : null,
  ]);

  const statsById = new Map(stats.map((s) => [s.parentPageId, s]));
  const keysById = new Map<string, Set<string>>();
  const addKey = (notebookId: string | null, m: IdentityRow | null) => {
    if (!notebookId || !m) return;
    const set = keysById.get(notebookId) ?? new Set<string>();
    set.add(audienceKeyOf(m));
    keysById.set(notebookId, set);
  };
  for (const s of seriesUsing) addKey(s.notebookId, s);
  for (const t of tabNotes) addKey(t.parentPageId, t.meetingNote);
  const seriesHolders = new Set(tabNotes.filter((t) => t.meetingNoteId === meetingId).map((t) => t.parentPageId));

  const candidates: NotebookCandidate[] = editable.map((r) => {
    const st = statsById.get(r.id);
    const dates = [st?._max.meetingOccurrenceStart, st?._max.createdAt].filter((d): d is Date => !!d);
    const keys = new Set(keysById.get(r.id) ?? []);
    if (r.notebookKey) keys.add(r.notebookKey);
    return {
      id: r.id,
      title: r.title,
      path: "",
      tabCount: st?._count._all ?? 0,
      lastNoteAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
      workspaceType: r.workspaceType,
      workspaceId: r.workspaceId,
      parentPageId: r.parentPageId,
      holdsSeriesNote: seriesHolders.has(r.id),
      audienceKeys: [...keys],
    };
  });

  const ranked = suggestNotebooks(candidates, {
    seriesNotebookId: meeting?.notebookId ?? null,
    projectId: input.projectId ?? meeting?.projectId ?? null,
    audienceKey: meeting ? audienceKeyOf(meeting) : null,
  }).slice(0, MAX_LISTED);

  const pageById = new Map(editable.map((r) => [r.id, r]));
  const paths = await notebookLocationPartsBulk(
    ranked.map((r) => pageById.get(r.id)!),
    input.actorId,
    input.request,
  );
  return ranked.map((r) => ({
    id: r.id,
    title: r.title,
    path: formatFiledPath(paths.get(r.id) ?? []),
    workspaceType: r.workspaceType,
    workspaceId: r.workspaceId,
    parentPageId: r.parentPageId,
    tabCount: r.tabCount,
    lastNoteAt: r.lastNoteAt?.toISOString() ?? null,
    suggested: r.suggested,
  }));
}
