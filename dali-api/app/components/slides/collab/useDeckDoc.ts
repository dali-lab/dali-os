import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { acquireCollabDoc, releaseCollabDoc, type CollabDocEntry } from "~/components/doc/collab-doc";
import { useReportSyncState } from "~/components/doc/use-report-sync-state";
import type { DocSyncState } from "~/components/doc/types";
import { slidesRoomName } from "~/collab/roomName";
import { agentKindOf, isAgentState, type AgentKind } from "~/components/collab/agent";
import { createDeckStore, type DeckStore } from "~/components/slides/deck/deck-store";
import { createDeckUndo, type DeckUndo } from "~/components/slides/deck/deck-undo";
import { deckMap, slidesMap } from "~/components/slides/deck/model";
import type { Placed } from "~/components/slides/deck/freeform";
import type { DeckSnapshot } from "~/components/slides/deck/snapshot";

export interface DeckDoc {
  entry: CollabDocEntry;
  doc: Y.Doc;
  store: DeckStore;
  undo: DeckUndo;
}

/** The deck's room as a live doc, its plain-data view and its one undo history. Null until all three exist. */
export function useDeckDoc(pageId: string, token: string): DeckDoc | null {
  const room = slidesRoomName(pageId);
  const [entry, setEntry] = useState<CollabDocEntry | null>(null);
  useEffect(() => {
    setEntry(acquireCollabDoc(room, token));
    return () => {
      releaseCollabDoc(room);
      setEntry(null);
    };
  }, [room, token]);

  const [parts, setParts] = useState<{ store: DeckStore; undo: DeckUndo } | null>(null);
  useEffect(() => {
    if (!entry) return;
    const store = createDeckStore(entry.ydoc);
    const undo = createDeckUndo([slidesMap(entry.ydoc), deckMap(entry.ydoc)]);
    setParts({ store, undo });
    return () => {
      store.destroy();
      undo.destroy();
      setParts(null);
    };
  }, [entry]);

  return useMemo(() => (entry && parts ? { entry, doc: entry.ydoc, ...parts } : null), [entry, parts]);
}

const EMPTY: DeckSnapshot = { v: undefined, themeId: "dali-dark", epoch: 0, slides: [], deletedIds: [], deletedBy: {} };

export function useDeckSnapshot(deck: DeckDoc | null): DeckSnapshot {
  return useSyncExternalStore(
    (cb) => (deck ? deck.store.subscribe(cb) : () => {}),
    () => (deck ? deck.store.getSnapshot() : EMPTY),
    () => EMPTY,
  );
}

export function useDeckSync(deck: DeckDoc | null): { state: DocSyncState; synced: boolean } {
  const [state, setState] = useState<DocSyncState>("saving");
  const [synced, setSynced] = useState(false);
  const provider = deck?.entry.provider;
  useEffect(() => {
    if (!provider) return;
    setSynced(provider.synced);
    const on = () => setSynced(true);
    provider.on("synced", on);
    return () => {
      provider.off("synced", on);
    };
  }, [provider]);
  useReportSyncState((provider ?? NO_PROVIDER) as never, setState);
  return { state, synced };
}

const NO_PROVIDER = {
  on() {},
  off() {},
  hasUnsyncedChanges: false,
  synced: false,
  configuration: { websocketProvider: { status: "disconnected" } },
};

/** Whether undo and redo have anything to do, kept current as history changes. */
export function useUndoState(undo: DeckUndo | null): { canUndo: boolean; canRedo: boolean } {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!undo) return;
    const m = undo.manager;
    const on = () => bump((n) => n + 1);
    for (const e of ["stack-item-added", "stack-item-popped", "stack-cleared"] as const) m.on(e, on as never);
    return () => {
      for (const e of ["stack-item-added", "stack-item-popped", "stack-cleared"] as const) m.off(e, on as never);
    };
  }, [undo]);
  return { canUndo: undo?.manager.canUndo() ?? false, canRedo: undo?.manager.canRedo() ?? false };
}

export interface SlidePeer {
  clientId: number;
  userId?: string;
  name: string;
  color: string;
  photoUrl: string | null;
  agent?: { kind: AgentKind };
}

export interface DeckUser {
  userId: string;
  name: string;
  color: string;
  photoUrl: string | null;
}

/** Announces which slide I am on, and lists who else is on each slide. */
export function useSlidePresence(deck: DeckDoc | null, me: DeckUser, slideId: string | null): Map<string, SlidePeer[]> {
  const awareness = deck?.entry.provider.awareness ?? null;
  const [peers, setPeers] = useState<Map<string, SlidePeer[]>>(new Map());
  useEffect(() => {
    if (!awareness) return;
    awareness.setLocalStateField("deckSlide", slideId ? { slideId, ...me } : null);
  }, [awareness, slideId, me.userId, me.name, me.color, me.photoUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!awareness) return;
    const update = () => {
      const next = new Map<string, SlidePeer[]>();
      awareness.getStates().forEach((state, clientId) => {
        const s = state.deckSlide as ({ slideId: string; agent?: { kind?: unknown } } & DeckUser) | null | undefined;
        if (!s || typeof s.slideId !== "string" || clientId === awareness.clientID) return;
        const agent = isAgentState(state) ? { kind: agentKindOf(s.agent?.kind) } : undefined;
        if (!agent && s.userId === me.userId) return;
        const list = next.get(s.slideId) ?? [];
        const seen = agent ? list.some((p) => p.clientId === clientId) : list.some((p) => !p.agent && p.userId === s.userId);
        if (!seen) list.push({ clientId, userId: s.userId, name: s.name, color: s.color, photoUrl: agent ? null : (s.photoUrl ?? null), ...(agent ? { agent } : {}) });
        next.set(s.slideId, list);
      });
      setPeers(next);
    };
    awareness.on("change", update);
    update();
    return () => {
      awareness.off("change", update);
    };
  }, [awareness, me.userId]);
  return peers;
}

export interface DragState {
  slideId: string;
  rects: Record<string, Placed>;
}

const finiteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Peers' in-flight drags on a slide, read defensively: awareness is whatever a client sent. */
export function readPeerDrags(states: Iterable<[number, Record<string, unknown>]>, selfId: number, slideId: string): Map<string, Placed> {
  const out = new Map<string, Placed>();
  for (const [clientId, state] of states) {
    if (clientId === selfId) continue;
    const drag = state.dragging as { slideId?: unknown; rects?: unknown } | null | undefined;
    if (!drag || drag.slideId !== slideId || typeof drag.rects !== "object" || drag.rects === null) continue;
    for (const [id, r] of Object.entries(drag.rects as Record<string, Record<string, unknown>>)) {
      if (r && finiteNum(r.x) && finiteNum(r.y) && finiteNum(r.w) && finiteNum(r.h) && r.w > 0 && r.h > 0) {
        out.set(id, { x: r.x, y: r.y, w: r.w, h: r.h, rot: finiteNum(r.rot) ? r.rot : 0 });
      }
    }
  }
  return out;
}

/** Shares my drag through awareness so peers see it move, and reads theirs. The doc is written only when the drag ends. */
export function useSlideDrags(deck: DeckDoc | null, slideId: string | null): { peers: ReadonlyMap<string, Placed>; publish: (rects: Map<string, Placed> | null) => void } {
  const awareness = deck?.entry.provider.awareness ?? null;
  const [peers, setPeers] = useState<ReadonlyMap<string, Placed>>(new Map());
  useEffect(() => {
    if (!awareness || !slideId) {
      setPeers(new Map());
      return;
    }
    const update = () => setPeers(readPeerDrags(awareness.getStates() as Map<number, Record<string, unknown>>, awareness.clientID, slideId));
    awareness.on("change", update);
    update();
    return () => {
      awareness.off("change", update);
    };
  }, [awareness, slideId]);
  const pending = useRef<{ frame: number | null; rects: Map<string, Placed> | null }>({ frame: null, rects: null });
  const publish = useCallback(
    (rects: Map<string, Placed> | null) => {
      if (!awareness || !slideId) return;
      const state = pending.current;
      state.rects = rects;
      if (rects === null) {
        if (state.frame !== null) cancelAnimationFrame(state.frame);
        state.frame = null;
        awareness.setLocalStateField("dragging", null);
        return;
      }
      if (state.frame !== null) return;
      state.frame = requestAnimationFrame(() => {
        state.frame = null;
        if (state.rects) awareness.setLocalStateField("dragging", { slideId, rects: Object.fromEntries(state.rects) } satisfies DragState);
      });
    },
    [awareness, slideId],
  );
  useEffect(() => () => publish(null), [publish]);
  return { peers, publish };
}
