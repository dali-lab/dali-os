// Ranking for the notebook picker: which notebooks to offer first when filing a
// meeting note. Pure, so the rules are tested without Prisma.

export type NotebookCandidate = {
  id: string;
  title: string;
  path: string;
  tabCount: number;
  lastNoteAt: Date | null;
  workspaceType: string;
  workspaceId: string | null;
  parentPageId: string | null;
  /** True when the notebook already holds a note of the series being filed. */
  holdsSeriesNote: boolean;
  /** Audience keys (see meetingNotebookIdentity) of the meetings that use it. */
  audienceKeys: string[];
};

export type SuggestContext = {
  /** The series' current default notebook. */
  seriesNotebookId: string | null;
  /** The project the meeting is about. */
  projectId: string | null;
  /** The meeting's own audience key; null when there is no meeting yet. */
  audienceKey: string | null;
};

export type SuggestedNotebook = NotebookCandidate & { suggested: boolean };

export function isSuggested(row: NotebookCandidate, ctx: SuggestContext): boolean {
  return (
    (ctx.seriesNotebookId !== null && row.id === ctx.seriesNotebookId) ||
    row.holdsSeriesNote ||
    (ctx.projectId !== null && row.workspaceType === "Project" && row.workspaceId === ctx.projectId) ||
    (ctx.audienceKey !== null && row.audienceKeys.includes(ctx.audienceKey))
  );
}

const byRecent = (a: NotebookCandidate, b: NotebookCandidate) =>
  (b.lastNoteAt?.getTime() ?? -Infinity) - (a.lastNoteAt?.getTime() ?? -Infinity) ||
  a.title.localeCompare(b.title);

/** Suggested notebooks first, then the rest, each group most recent note first. */
export function suggestNotebooks(rows: NotebookCandidate[], ctx: SuggestContext): SuggestedNotebook[] {
  const flagged = rows.map((row) => ({ ...row, suggested: isSuggested(row, ctx) }));
  return [...flagged.filter((r) => r.suggested).sort(byRecent), ...flagged.filter((r) => !r.suggested).sort(byRecent)];
}
