import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { getCollabUrl } from "./util";

// ─── useSharedArray ──────────────────────────────────────────────────────────

/**
 * Move one item of a Y.Array<Y.Map> so it ends up at index `to` (the same
 * result as splicing it out and back in). The item is copied into a fresh map:
 * a Y type can't be re-inserted once deleted — Yjs integrates it as an empty
 * map and the item's content is lost.
 */
export function moveYArrayItem(
  yarray: Y.Array<Y.Map<unknown>>,
  from: number,
  to: number,
): void {
  if (from === to) return;
  yarray.doc!.transact(() => {
    const copy = new Y.Map<unknown>();
    for (const [k, v] of yarray.get(from).entries()) copy.set(k, v);
    yarray.delete(from, 1);
    yarray.insert(to, [copy]);
  });
}

/**
 * Overwrite the item at `index` in place, field by field, so a concurrent
 * edit to a different item survives the merge (a whole-list replace would
 * duplicate it).
 */
export function replaceYArrayItem(
  yarray: Y.Array<Y.Map<unknown>>,
  index: number,
  item: object,
): void {
  const m = yarray.get(index);
  if (!m) return;
  yarray.doc!.transact(() => {
    for (const k of [...m.keys()]) if (!(k in item)) m.delete(k);
    for (const [k, v] of Object.entries(item)) m.set(k, v);
  });
}

/**
 * Delete empty maps and every item whose `field` repeats an earlier item's.
 * Every client keeps the first occurrence, so concurrent cleanups agree.
 * Returns true when it deleted anything.
 */
export function dropInvalidYArrayItems(
  yarray: Y.Array<Y.Map<unknown>>,
  field?: string,
): boolean {
  const seen = new Set<unknown>();
  const drop = yarray.toArray().flatMap((m, i) => {
    if (m.size === 0) return [i];
    if (!field || !m.has(field)) return [];
    const id = m.get(field);
    if (seen.has(id)) return [i];
    seen.add(id);
    return [];
  });
  if (drop.length === 0) return false;
  yarray.doc!.transact(() => {
    for (const i of drop.reverse()) yarray.delete(i, 1);
  });
  return true;
}

export interface UseSharedArrayResult<T> {
  items: T[];
  /** Replace the full list. */
  setItems: (next: T[]) => void;
  /** Overwrite the item at `index` without touching the rest of the list. */
  replace: (index: number, item: T) => void;
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
 * @param uniqueField   Item field that identifies an item (e.g. a question's
 *                      `key`). Repeats are hidden and deleted: two clients
 *                      seeding the same empty room both write the seed.
 */
export function useSharedArray<T extends object>(
  documentName: string,
  token: string | null | undefined,
  yKey = "items",
  initialItems: T[] = [],
  uniqueField?: string,
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

    const readItems = () => {
      const seen = new Set<unknown>();
      return yarray
        .toArray()
        .filter((m) => {
          if (m.size === 0) return false;
          if (!uniqueField || !m.has(uniqueField)) return true;
          const id = m.get(uniqueField);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((m) => Object.fromEntries(m.entries()) as T);
    };

    const handleSynced = () => {
      if (yarray.length > 0) {
        dropInvalidYArrayItems(yarray, uniqueField);
        setLocalItems(readItems());
      } else if (initialRef.current.some((item) => Object.keys(item).length > 0)) {
        ydoc.transact(() => {
          for (const item of initialRef.current) {
            if (Object.keys(item).length === 0) continue;
            const m = new Y.Map<unknown>();
            for (const [k, v] of Object.entries(item)) m.set(k, v);
            yarray.push([m]);
          }
        });
        setLocalItems(readItems());
      }
      setSynced(true);
    };

    const handleChange = (_events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
      if (!tr.local && uniqueField) dropInvalidYArrayItems(yarray, uniqueField);
      setLocalItems(readItems());
    };

    provider.on("synced", handleSynced);
    yarray.observeDeep(handleChange);

    return () => {
      provider.off("synced", handleSynced);
      yarray.unobserveDeep(handleChange);
      um.off("stack-item-added", syncUndoState);
      um.off("stack-item-popped", syncUndoState);
      yarrayRef.current = null;
      undoRef.current = null;
      um.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [documentName, token, yKey, uniqueField]);

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

  const replace = useCallback((index: number, item: T) => {
    const yarray = yarrayRef.current;
    if (!yarray) {
      setLocalItems((prev) => prev.map((p, i) => (i === index ? item : p)));
      return;
    }
    // `index` counts the visible list, which hides repeats and empty maps.
    const id = uniqueField ? (item as Record<string, unknown>)[uniqueField] : undefined;
    const raw = id === undefined ? index : yarray.toArray().findIndex((m) => m.get(uniqueField!) === id);
    if (raw !== -1) replaceYArrayItem(yarray, raw, item);
  }, [uniqueField]);

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
    moveYArrayItem(yarray, from, to);
  }, []);

  const undo = useCallback(() => {
    undoRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoRef.current?.redo();
  }, []);

  return { items, setItems, replace, push, remove, move, undo, redo, canUndo, canRedo, synced };
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
