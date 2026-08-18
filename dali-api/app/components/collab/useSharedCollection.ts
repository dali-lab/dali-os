import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { getCollabUrl } from "./util";

// ─── useSharedArray ──────────────────────────────────────────────────────────

export interface UseSharedArrayResult<T> {
  items: T[];
  /** Replace the full list. */
  setItems: (next: T[]) => void;
  /** Append a single item. */
  push: (item: T) => void;
  /** Remove the item at `index`. */
  remove: (index: number) => void;
  /** Move item from `from` to `to` (for drag-reorder). */
  move: (from: number, to: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  synced: boolean;
}

/**
 * Live-synced ordered list backed by a Hocuspocus-persisted Y.Array<Y.Map>.
 *
 * Each element is stored as a Y.Map so individual field mutations merge cleanly
 * under concurrent edits — callers should treat `T` as a plain-JS snapshot of
 * the Y.Map contents. The UndoManager is native Y.js (not y-prosemirror) so
 * the yUndoPlugin destroy-on-disconnect bug class cannot occur.
 *
 * Follow the useSharedString provider/connect/cleanup pattern exactly.
 *
 * @param documentName  Hocuspocus room name (e.g. `form:{id}:draft`).
 * @param token         Session token from the loader; null/undefined suspends.
 * @param yKey          Y.Array key inside the Y.Doc (defaults to "items").
 * @param initialItems  Written into the array on first connect if the room is
 *                      empty — only at bootstrap, like useSharedString's
 *                      initialValue. Callers should seed this from the
 *                      Postgres draftQuestions / criteria column so a new room
 *                      opens with the current saved content.
 */
export function useSharedArray<T extends object>(
  documentName: string,
  token: string | null | undefined,
  yKey = "items",
  initialItems: T[] = [],
): UseSharedArrayResult<T> {
  const [items, setLocalItems] = useState<T[]>(initialItems);
  const [synced, setSynced] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const yarrayRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const initialRef = useRef(initialItems);
  initialRef.current = initialItems;

  useEffect(() => {
    if (!token) return;

    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: getCollabUrl(),
      name: documentName,
      document: ydoc,
      token,
    });
    const yarray = ydoc.getArray<Y.Map<unknown>>(yKey);
    yarrayRef.current = yarray;

    // Native UndoManager scoped to the single Y.Array so undo/redo operate
    // only on this field, not unrelated shared types in the same Y.Doc.
    const um = new Y.UndoManager(yarray);
    undoRef.current = um;

    const syncUndoState = () => {
      setCanUndo(um.canUndo());
      setCanRedo(um.canRedo());
    };

    um.on("stack-item-added", syncUndoState);
    um.on("stack-item-popped", syncUndoState);

    const readItems = () => yarray.toArray().map((m) => Object.fromEntries(m.entries()) as T);

    const handleSynced = () => {
      if (yarray.length > 0) {
        setLocalItems(readItems());
      } else if (initialRef.current.length > 0) {
        // Seed empty room from the Postgres snapshot (mirrors useSharedString's
        // initialValue bootstrap: write once, then defer to CRDT state).
        ydoc.transact(() => {
          for (const item of initialRef.current) {
            const m = new Y.Map<unknown>();
            for (const [k, v] of Object.entries(item)) m.set(k, v);
            yarray.push([m]);
          }
        });
        setLocalItems(initialRef.current);
      }
      setSynced(true);
    };

    const handleChange = () => setLocalItems(readItems());

    provider.on("synced", handleSynced);
    yarray.observe(handleChange);

    return () => {
      provider.off("synced", handleSynced);
      yarray.unobserve(handleChange);
      um.off("stack-item-added", syncUndoState);
      um.off("stack-item-popped", syncUndoState);
      yarrayRef.current = null;
      undoRef.current = null;
      um.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [documentName, token, yKey]);

  const setItems = useCallback((next: T[]) => {
    const yarray = yarrayRef.current;
    if (!yarray) {
      // No collab room active — update local state directly.
      setLocalItems(next);
      return;
    }
    yarray.doc!.transact(() => {
      yarray.delete(0, yarray.length);
      for (const item of next) {
        const m = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(item)) m.set(k, v);
        yarray.push([m]);
      }
    });
    setLocalItems(next);
  }, []);

  const push = useCallback((item: T) => {
    const yarray = yarrayRef.current;
    if (!yarray) {
      // No collab room active — append to local state directly.
      setLocalItems((prev) => [...prev, item]);
      return;
    }
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(item)) m.set(k, v);
    yarray.push([m]);
  }, []);

  const remove = useCallback((index: number) => {
    const yarray = yarrayRef.current;
    if (!yarray) {
      // No collab room active — remove from local state directly.
      setLocalItems((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    yarray.delete(index, 1);
  }, []);

  const move = useCallback((from: number, to: number) => {
    const yarray = yarrayRef.current;
    if (from === to) return;
    if (!yarray) {
      // No collab room active — reorder local state directly.
      setLocalItems((prev) => {
        const next = [...prev];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return next;
      });
      return;
    }
    yarray.doc!.transact(() => {
      const [item] = yarray.slice(from, from + 1);
      yarray.delete(from, 1);
      // Adjust target index if the item was removed before the destination.
      const insertAt = from < to ? to - 1 : to;
      yarray.insert(insertAt, [item]);
    });
  }, []);

  const undo = useCallback(() => {
    undoRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoRef.current?.redo();
  }, []);

  return { items, setItems, push, remove, move, undo, redo, canUndo, canRedo, synced };
}

// ─── useSharedMap ────────────────────────────────────────────────────────────

export interface UseSharedMapResult<T extends object> {
  data: Partial<T>;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  setMany: (patch: Partial<T>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  synced: boolean;
}

/**
 * Live-synced key-value store backed by a Hocuspocus-persisted Y.Map.
 *
 * Use when you need a small set of typed fields that multiple clients may
 * edit concurrently (e.g. rubric metadata, form settings). Individual key
 * mutations merge without conflict. The UndoManager is native Y.js.
 *
 * @param documentName  Hocuspocus room name.
 * @param token         Session token; null/undefined suspends.
 * @param yKey          Y.Map key inside the Y.Doc (defaults to "data").
 * @param initialData   Bootstrap seed written on first connect if the map is
 *                      empty, then ignored — same model as useSharedString.
 */
export function useSharedMap<T extends object>(
  documentName: string,
  token: string | null | undefined,
  yKey = "data",
  initialData: Partial<T> = {},
): UseSharedMapResult<T> {
  const [data, setLocalData] = useState<Partial<T>>(initialData);
  const [synced, setSynced] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const ymapRef = useRef<Y.Map<unknown> | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const initialRef = useRef(initialData);
  initialRef.current = initialData;

  useEffect(() => {
    if (!token) return;

    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: getCollabUrl(),
      name: documentName,
      document: ydoc,
      token,
    });
    const ymap = ydoc.getMap<unknown>(yKey);
    ymapRef.current = ymap;

    const um = new Y.UndoManager(ymap);
    undoRef.current = um;

    const syncUndoState = () => {
      setCanUndo(um.canUndo());
      setCanRedo(um.canRedo());
    };
    um.on("stack-item-added", syncUndoState);
    um.on("stack-item-popped", syncUndoState);

    const readData = () => Object.fromEntries(ymap.entries()) as Partial<T>;

    const handleSynced = () => {
      if (ymap.size > 0) {
        setLocalData(readData());
      } else {
        const init = initialRef.current;
        if (Object.keys(init).length > 0) {
          ydoc.transact(() => {
            for (const [k, v] of Object.entries(init)) ymap.set(k, v);
          });
          setLocalData(init);
        }
      }
      setSynced(true);
    };

    const handleChange = () => setLocalData(readData());

    provider.on("synced", handleSynced);
    ymap.observe(handleChange);

    return () => {
      provider.off("synced", handleSynced);
      ymap.unobserve(handleChange);
      um.off("stack-item-added", syncUndoState);
      um.off("stack-item-popped", syncUndoState);
      ymapRef.current = null;
      undoRef.current = null;
      um.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [documentName, token, yKey]);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    ymapRef.current?.set(key as string, value);
  }, []);

  const setMany = useCallback((patch: Partial<T>) => {
    const ymap = ymapRef.current;
    if (!ymap) return;
    ymap.doc!.transact(() => {
      for (const [k, v] of Object.entries(patch)) ymap.set(k, v);
    });
  }, []);

  const undo = useCallback(() => {
    undoRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoRef.current?.redo();
  }, []);

  return { data, set, setMany, undo, redo, canUndo, canRedo, synced };
}
