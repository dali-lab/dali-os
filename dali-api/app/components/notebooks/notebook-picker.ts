import { formatDateShort } from "~/lib/display";

export type PickedNotebook = {
  id: string;
  title: string;
  path: string;
  workspaceType: string;
  workspaceId: string | null;
};

export type NotebookRow = PickedNotebook & { tabCount: number; lastNoteAt: string | null; suggested: boolean };

export type NotebookListState = { rows: NotebookRow[]; status: "loading" | "ready" | "error" };

export async function fetchNotebookRows(query: string, ctx: { projectId?: string | null; meetingId?: string | null }): Promise<NotebookRow[]> {
  const qs = notebookQueryString(query, ctx);
  const res = await fetch(`/api/notebooks${qs ? `?${qs}` : ""}`, { credentials: "include" });
  if (!res.ok) throw new Error("Request failed");
  return ((await res.json()) as { notebooks: NotebookRow[] }).notebooks;
}

export function notebookQueryString(q: string, ctx: { projectId?: string | null; meetingId?: string | null }): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (ctx.projectId) params.set("projectId", ctx.projectId);
  if (ctx.meetingId) params.set("meetingId", ctx.meetingId);
  return params.toString();
}

/** "3 notes · last Oct 9, 2026"; just the count for a notebook with no dated note. */
export function notebookStats(row: { tabCount: number; lastNoteAt: string | null }): string {
  const notes = `${row.tabCount} ${row.tabCount === 1 ? "note" : "notes"}`;
  return row.lastNoteAt ? `${notes} · last ${formatDateShort(row.lastNoteAt)}` : notes;
}
