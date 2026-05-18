import { useEffect, useRef } from "react";
import { boardRoomName, type BoardEvent } from "~/collab/board";
import { getCollabUrl } from "~/components/collab/util";

interface Options {
  projectId: string;
  token: string | null;
  userName: string;
  onPeerEvent: (event: BoardEvent) => void;
}

/**
 * Subscribe to the project's board awareness room. When a peer (or the local
 * tab, after a mutation) sets a `boardEvent` awareness field, fire the
 * callback so the loader re-runs.
 *
 * The local tab also broadcasts after each mutation via broadcastBoardEvent —
 * exported below so action handlers can fire-and-forget.
 */
export function useBoardSync({ projectId, token, userName, onPeerEvent }: Options) {
  const cbRef = useRef(onPeerEvent);
  cbRef.current = onPeerEvent;

  useEffect(() => {
    if (!token) return;
    if (typeof window === "undefined") return;

    let provider: { destroy: () => void } | null = null;
    let cancelled = false;
    let lastTs = 0;

    (async () => {
      const mod = await import("@hocuspocus/provider");
      if (cancelled) return;
      const ProviderCtor = mod.HocuspocusProvider;
      const p = new ProviderCtor({
        url: getCollabUrl(),
        name: boardRoomName(projectId),
        token,
        onAwarenessUpdate: ({ states }: { states: Array<Record<string, unknown>> }) => {
          for (const s of states) {
            const ev = s.boardEvent as BoardEvent | undefined;
            if (!ev) continue;
            if (ev.ts <= lastTs) continue;
            if (ev.projectId !== projectId) continue;
            lastTs = ev.ts;
            cbRef.current(ev);
          }
        },
      });
      provider = p as unknown as { destroy: () => void };
      // Stash on a window-scoped registry so other components in the same
      // tab can broadcast through it without each opening their own provider.
      (window as unknown as { __daliBoardProviders?: Record<string, unknown> }).__daliBoardProviders ??= {};
      ((window as unknown as { __daliBoardProviders: Record<string, unknown> }).__daliBoardProviders)[projectId] = p;
    })().catch(() => {});

    return () => {
      cancelled = true;
      const reg = (window as unknown as { __daliBoardProviders?: Record<string, unknown> }).__daliBoardProviders;
      if (reg) delete reg[projectId];
      provider?.destroy();
    };
  }, [projectId, token, userName]);
}

/**
 * Fire-and-forget broadcast. Looks up the active provider opened by
 * useBoardSync in this tab. No-op if none is registered (e.g. the user
 * triggered a mutation from a place where the board sync isn't mounted).
 */
export function broadcastBoardEvent(event: BoardEvent): void {
  if (typeof window === "undefined") return;
  const reg = (window as unknown as { __daliBoardProviders?: Record<string, unknown> }).__daliBoardProviders;
  const provider = reg?.[event.projectId] as
    | { awareness?: { setLocalStateField: (k: string, v: unknown) => void } }
    | undefined;
  if (!provider?.awareness) return;
  provider.awareness.setLocalStateField("boardEvent", event);
  // Clear shortly after so a remount doesn't re-trigger the same event.
  setTimeout(() => {
    provider.awareness?.setLocalStateField("boardEvent", null);
  }, 1500);
}
