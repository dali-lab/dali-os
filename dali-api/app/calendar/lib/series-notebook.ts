// The series' default notebook: when a note filed elsewhere is worth offering
// as the new default, and the request that changes it. Pure so the rules are
// tested without a browser.

export type SeriesScope = "future" | "all";

/** True when a note landed in a notebook other than the series' current default. */
export function seriesDefaultDiffers(filedNotebookId: string | null, seriesNotebookId: string | null): boolean {
  return filedNotebookId !== null && seriesNotebookId !== null && filedNotebookId !== seriesNotebookId;
}

type Fetch = (input: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export type SeriesNotebookResult = { ok: boolean; moved: number; skipped: number; error?: string };

/** Point the series at a notebook (or none). "future" only changes where later
 *  occurrences file; "all" also moves the notes already taken. */
export async function setSeriesNotebookRequest(
  meetingId: string,
  notebookId: string | null,
  scope: SeriesScope,
  doFetch: Fetch = (input, init) => fetch(input, init),
): Promise<SeriesNotebookResult> {
  const res = await doFetch(`/api/scheduled-meetings/${meetingId}/notebook`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notebookId, scope }),
  });
  const json = (await res.json().catch(() => ({}))) as { moved?: number; skipped?: number; error?: string };
  if (!res.ok) return { ok: false, moved: 0, skipped: 0, error: json.error ?? "Couldn't change the notebook" };
  return { ok: true, moved: json.moved ?? 0, skipped: json.skipped ?? 0 };
}
