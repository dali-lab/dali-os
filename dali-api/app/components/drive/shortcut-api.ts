import { useCallback, useEffect, useState } from "react";
import type { Placements, ServerDest } from "~/components/drive/file-in";

async function errorOf(res: Response, fallback: string): Promise<string> {
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? fallback;
}

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function call<T>(url: string, init: RequestInit, fallback: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { credentials: "include", ...init });
    if (!res.ok) return { ok: false, error: await errorOf(res, fallback) };
    return { ok: true, ...((await res.json().catch(() => ({}))) as T) };
  } catch {
    return { ok: false, error: fallback };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchPlacements(pageId: string): Promise<Placements | null> {
  const res = await call<Placements>(`/api/pages/${pageId}/shortcuts`, { method: "GET" }, "Couldn't load locations");
  return res.ok ? { primary: res.primary, shortcuts: res.shortcuts } : null;
}

/** The raw request, for the hub's delete paths that report in their own way. */
export function deleteShortcutRequest(shortcutId: string): Promise<Response> {
  return fetch(`/api/shortcuts/${shortcutId}`, { method: "DELETE", credentials: "include" });
}

export function createShortcutRequest(targetPageId: string, dest: ServerDest) {
  return call<{ created: boolean; grantDeclined: boolean }>(
    "/api/shortcuts",
    json("POST", { targetPageId, dest }),
    "Couldn't add the shortcut",
  );
}

export function placePageRequest(pageId: string, destinations: ServerDest[], primaryIndex: number) {
  return call<{ declined: number }>(
    `/api/pages/${pageId}/place`,
    json("POST", { destinations, primaryIndex }),
    "Couldn't file it there",
  );
}

export function swapPrimaryRequest(pageId: string, shortcutId: string) {
  return call<Record<string, never>>(
    `/api/pages/${pageId}/swap-primary`,
    json("POST", { shortcutId }),
    "Couldn't make that the primary location",
  );
}

/** The page's own place and its shortcuts, loaded when `pageId` is set. `reload` refetches after a change. */
export function usePlacements(pageId: string | null) {
  const [state, setState] = useState<{ pageId: string; placements: Placements | null } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!pageId) return;
    let live = true;
    void fetchPlacements(pageId).then((placements) => {
      if (live) setState({ pageId, placements });
    });
    return () => {
      live = false;
    };
  }, [pageId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = pageId && state?.pageId === pageId ? state : null;
  return { placements: current?.placements ?? null, loading: !!pageId && current === null, reload };
}
