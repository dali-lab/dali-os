// The requests the notebook controls send, built apart from the React that
// sends them so their shapes are tested.

export type NotebookIntent =
  | { intent: "new-note" }
  | { intent: "set-template"; templatePageId: string | null }
  | { intent: "add-page"; pageId: string }
  | { intent: "merge-into"; targetId: string }
  | { intent: "dissolve" }
  | { intent: "trash" };

export type JsonRequest = { url: string; body: unknown };

export function notebookRequest(notebookId: string, body: NotebookIntent): JsonRequest {
  return { url: `/api/notebooks/${notebookId}`, body };
}

export function createNotebookRequest(input: {
  title: string;
  workspaceType: string;
  workspaceId: string | null;
  parentPageId: string | null;
}): JsonRequest {
  return {
    url: "/api/notebooks",
    body: {
      title: input.title.trim(),
      workspaceType: input.workspaceType,
      workspaceId: input.workspaceId,
      parentPageId: input.parentPageId,
      templatePageId: null,
    },
  };
}

export function detachRequest(pageId: string): JsonRequest {
  return { url: `/api/pages/${pageId}/meeting`, body: { intent: "detach-meeting" } };
}

export function renameRequest(pageId: string, title: string): JsonRequest {
  return { url: `/api/documents/${pageId}`, body: { title: title.trim() } };
}

/** Leaving a notebook is an ordinary move into the folder the notebook sits in. */
export function removeFromNotebookRequest(
  pageId: string,
  notebook: { workspaceType: string; workspaceId: string | null; folderId: string | null },
): JsonRequest {
  return {
    url: `/api/pages/${pageId}/move`,
    body: {
      workspaceType: notebook.workspaceType,
      workspaceId: notebook.workspaceId,
      parentPageId: notebook.folderId,
    },
  };
}

type Fetch = (input: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** POST a request as JSON; `error` carries the server's message on a failure,
 *  `data` the parsed body on success. */
export async function sendJson<T = Record<string, unknown>>(
  req: JsonRequest,
  doFetch: Fetch = (input, init) => fetch(input, init),
): Promise<{ ok: boolean; error?: string; data?: T }> {
  try {
    const res = await doFetch(req.url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.ok) return { ok: true, data: json };
    return { ok: false, error: json.error ?? "Something went wrong" };
  } catch {
    return { ok: false, error: "Something went wrong" };
  }
}
