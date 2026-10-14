// What the server says about a meeting note it just filed, and how to take it
// back. Pure so the undo rules are tested without a browser.

export type FiledNote = {
  notePageId: string;
  /** The notebook the note is a tab of. */
  notebookId: string | null;
  /** True only when the same request created that notebook. */
  createdNotebook: boolean;
  notePath: { label: string; href: string };
  /** Set when the notebook was asked to move and the server refused. */
  declinedMove: { error: string } | null;
};

type Fetch = (input: string, init?: RequestInit) => Promise<{ ok: boolean }>;

/**
 * Trash the note, then the notebook if this action created it. The notebook
 * goes only while it is still empty (the server enforces that), so a note
 * someone filed there in the meantime keeps it.
 */
export async function undoFiledNote(
  filed: Pick<FiledNote, "notePageId" | "notebookId" | "createdNotebook">,
  doFetch: Fetch = (input, init) => fetch(input, init),
): Promise<{ ok: boolean; notebookTrashed: boolean }> {
  const init: RequestInit = { method: "DELETE", credentials: "include" };
  const note = await doFetch(`/api/documents/${filed.notePageId}`, init);
  if (!note.ok) return { ok: false, notebookTrashed: false };
  if (!filed.createdNotebook || !filed.notebookId) return { ok: true, notebookTrashed: false };
  const notebook = await doFetch(`/api/documents/${filed.notebookId}?ifEmpty=1`, init);
  return { ok: true, notebookTrashed: notebook.ok };
}

/** The filing fields of a create response (all optional: a meeting may keep no note). */
export type FiledNoteResponse = {
  ok?: boolean;
  error?: string;
  notePageId?: string | null;
  notebookId?: string | null;
  createdNotebook?: boolean;
  notePath?: { label: string; href: string } | null;
  declinedMove?: { error: string } | null;
};

/** The filing details from a create response, or null when the server named no path. */
export function filedNoteFrom(json: FiledNoteResponse): FiledNote | null {
  if (!json.notePageId || !json.notePath) return null;
  return {
    notePageId: json.notePageId,
    notebookId: json.notebookId ?? null,
    createdNotebook: json.createdNotebook === true,
    notePath: json.notePath,
    declinedMove: json.declinedMove ? { error: json.declinedMove.error } : null,
  };
}

/** What to tell the organizer when a notebook they asked to move stayed put. */
export function declinedMoveMessage(place: string | undefined): string {
  return `Could not move the notebook to ${place ?? "that place"}; it stayed where it was.`;
}
