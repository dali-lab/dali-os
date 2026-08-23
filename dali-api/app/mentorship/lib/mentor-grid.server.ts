import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import { weekNumberInTerm, weekStartForNumber, weeksInTerm } from "./week";
import type { Vibe } from "./vibe";

// The mentor → mentee → week matrix shared by the Mentorship notes page and the
// hub. Each pair (mentor, mentee, project, domain) is one row; each shown week
// is one cell — a submitted note (with its vibe), a missing note (a due week
// with no note), or a future week (not yet due).

export type GridPerson = {
  id: string;
  firstName: string;
  lastName: string;
  // Resolved (browser-usable) profile photo URL, or null.
  photoUrl: string | null;
};

export type GridCell = {
  week: number;
  // Monday-UTC ISO date for this week, so the client can create a note for it.
  weekOfIso: string;
  state: "submitted" | "missing" | "future";
  noteId: string | null;
  vibe: Vibe | null;
  // The viewer is this pair's mentor and the week is due but has no note yet —
  // clicking the cell opens (creates) the note.
  canCreate: boolean;
};

export type GridMenteeRow = {
  key: string;
  mentee: GridPerson;
  menteeId: string;
  projectId: string;
  domainId: string;
  projectName: string;
  domainCode: string;
  cells: GridCell[];
};

export type GridMentorGroup = {
  mentor: GridPerson;
  rows: GridMenteeRow[];
};

export type MentorGridResult = {
  // Week numbers shown as columns (all weeks, or a single filtered week).
  weeks: number[];
  // The term's current week (0 = not started, weeksCount = ended).
  currentWeek: number | null;
  mentors: GridMentorGroup[];
  // False when no term is selected — the grid has no week axis then.
  termSelected: boolean;
};

export type GridFilters = {
  projectId?: string;
  domainId?: string;
};

// DALI terms run 10 weeks; cap the grid at that even if a term's dates span
// more (e.g. an exam-week tail), so the week axis stays the familiar 1–10.
export const MAX_WEEKS = 10;

export function termWeekCount(start: Date, end: Date): number {
  return Math.min(MAX_WEEKS, weeksInTerm(start, end));
}

export async function buildGrid({
  term,
  pairScope,
  noteScope,
  filters = {},
  weekFilter = null,
  viewerId,
}: {
  term: { id: string; startDate: Date; endDate: Date };
  pairScope: Record<string, unknown>;
  noteScope: Record<string, unknown>;
  filters?: GridFilters;
  weekFilter?: number | null;
  viewerId: string;
}): Promise<MentorGridResult> {
  const weeksCount = termWeekCount(term.startDate, term.endDate);
  // Which week we're in now, clamped to [0, weeksCount]: 0 = term hasn't started
  // (everything future), weeksCount = term is over (everything due).
  const rawCurrent = weekNumberInTerm(new Date(), term.startDate);
  const currentWeek = Math.max(0, Math.min(weeksCount, rawCurrent));

  // Columns: a single week when a Week filter is set, else 1..weeksCount.
  const weeks =
    weekFilter && weekFilter >= 1 && weekFilter <= weeksCount
      ? [weekFilter]
      : Array.from({ length: weeksCount }, (_, i) => i + 1);

  const pairFilters: Record<string, unknown> = { termId: term.id };
  if (filters.projectId) pairFilters.projectId = filters.projectId;
  if (filters.domainId) pairFilters.domainId = filters.domainId;
  const pairWhere = { AND: [pairScope, pairFilters] };

  const noteFilters: Record<string, unknown> = { termId: term.id };
  if (filters.projectId) noteFilters.projectId = filters.projectId;
  if (filters.domainId) noteFilters.domainId = filters.domainId;
  const noteWhere = { AND: [noteScope, noteFilters] };

  const [pairs, notes] = await Promise.all([
    prisma.mentorshipPair.findMany({
      where: pairWhere,
      select: {
        mentorUserId: true,
        menteeUserId: true,
        projectId: true,
        domainId: true,
        mentor: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
        mentee: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      },
    }),
    prisma.mentorNote.findMany({
      where: noteWhere,
      select: {
        id: true,
        mentorId: true,
        menteeId: true,
        projectId: true,
        domainId: true,
        weekOf: true,
        vibe: true,
      },
    }),
  ]);

  // Denormalize project names + domain codes for the pair rows.
  const projectIds = [...new Set(pairs.map((p) => p.projectId))];
  const domainIds = [...new Set(pairs.map((p) => p.domainId))];
  const [projects, domains] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    }),
    prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true, code: true },
    }),
  ]);
  const pm = new Map(projects.map((p) => [p.id, p.name]));
  const dm = new Map(domains.map((d) => [d.id, d.code]));

  // Note lookup keyed by pair identity + week number.
  const noteByKey = new Map<string, { id: string; vibe: Vibe | null }>();
  for (const n of notes) {
    const wk = weekNumberInTerm(n.weekOf, term.startDate);
    noteByKey.set(
      `${n.mentorId}|${n.menteeId}|${n.projectId}|${n.domainId}|${wk}`,
      { id: n.id, vibe: n.vibe as Vibe | null },
    );
  }

  // Resolve each unique person's stored photo once (S3 presign / passthrough),
  // then stamp the resolved URL onto every GridPerson.
  const rawPhotoById = new Map<string, string | null>();
  for (const p of pairs) {
    rawPhotoById.set(p.mentor.id, p.mentor.photoUrl);
    rawPhotoById.set(p.mentee.id, p.mentee.photoUrl);
  }
  const photoById = new Map(
    await Promise.all(
      [...rawPhotoById].map(
        async ([id, raw]) =>
          [id, await resolvePhotoUrl(raw)] as [string, string | null],
      ),
    ),
  );
  const toPerson = (u: {
    id: string;
    firstName: string;
    lastName: string;
  }): GridPerson => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    photoUrl: photoById.get(u.id) ?? null,
  });

  // Group pairs by mentor.
  const byMentor = new Map<string, GridMentorGroup>();
  for (const p of pairs) {
    let group = byMentor.get(p.mentorUserId);
    if (!group) {
      group = { mentor: toPerson(p.mentor), rows: [] };
      byMentor.set(p.mentorUserId, group);
    }
    const cells: GridCell[] = weeks.map((week) => {
      const weekOfIso = weekStartForNumber(term.startDate, week).toISOString();
      const note = noteByKey.get(
        `${p.mentorUserId}|${p.menteeUserId}|${p.projectId}|${p.domainId}|${week}`,
      );
      if (note) {
        return { week, weekOfIso, state: "submitted", noteId: note.id, vibe: note.vibe, canCreate: false };
      }
      const future = week > currentWeek;
      return {
        week,
        weekOfIso,
        state: future ? "future" : "missing",
        noteId: null,
        vibe: null,
        // The pair's mentor can start a note, but only for a week that's
        // actually due — future weeks stay inert (and look identical) for
        // everyone. Others can only open notes that already exist.
        canCreate: !future && p.mentorUserId === viewerId,
      };
    });
    group.rows.push({
      key: `${p.mentorUserId}|${p.menteeUserId}|${p.projectId}|${p.domainId}`,
      mentee: toPerson(p.mentee),
      menteeId: p.menteeUserId,
      projectId: p.projectId,
      domainId: p.domainId,
      projectName: pm.get(p.projectId) ?? "Unknown",
      domainCode: dm.get(p.domainId) ?? "?",
      cells,
    });
  }

  const mentors = [...byMentor.values()];

  // Stable ordering: mentors by name, rows by mentee name then domain.
  const name = (u: GridPerson) => `${u.firstName} ${u.lastName}`.trim().toLowerCase();
  mentors.sort((a, b) => name(a.mentor).localeCompare(name(b.mentor)));
  for (const g of mentors) {
    g.rows.sort(
      (a, b) =>
        name(a.mentee).localeCompare(name(b.mentee)) ||
        a.domainCode.localeCompare(b.domainCode),
    );
  }

  return { weeks, currentWeek, mentors, termSelected: true };
}
