import { useEffect, useMemo, useRef, useState } from "react";
import type { DriveItem } from "~/drive/lib/drive.server";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";

export type DriveItemEntry = { item: DriveItem; scopeId: string };

export type DriveSelectionOptions = {
  itemIndex: Map<string, DriveItemEntry>;
  scopes: DriveTreeScope[];
  scopesFocusable: boolean;
  listing: DriveItem[];
  currentScopeId: string | null;
  currentFolderId: string | null;
  initialSelectedId?: string;
  revealId?: string;
  /** Called after a row takes focus, so a column view can move its keyboard column to that row. */
  followRow: (id: string) => void;
};

export function useDriveSelection({
  itemIndex,
  scopes,
  scopesFocusable,
  listing,
  currentScopeId,
  currentFolderId,
  initialSelectedId,
  revealId,
  followRow,
}: DriveSelectionOptions) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const selectedItems = useMemo(
    () => [...itemIndex.values()].filter((e) => selected.has(e.item.id)).map((e) => e.item),
    [itemIndex, selected],
  );

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => itemIndex.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setAnchorId((a) => (a && itemIndex.has(a) ? a : null));
    setFocusId((f) =>
      f && (itemIndex.has(f) || (scopesFocusable && scopes.some((s) => s.id === f))) ? f : null,
    );
  }, [itemIndex, scopesFocusable, scopes]);

  const focusEntry = focusId ? (itemIndex.get(focusId) ?? null) : null;

  // Declared before the reveal effects so a reveal's selection lands after this and wins.
  useEffect(() => {
    const here = new Set(listing.map((i) => i.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => here.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setAnchorId((a) => (a && here.has(a) ? a : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScopeId, currentFolderId]);

  function clearSelection() {
    setSelected(new Set());
    setAnchorId(null);
    setFocusId(null);
  }

  /** Focus this row and select it alone, or with `selectable` false just focus it (clearing the selection). Drives take focus but never selection. */
  function focusOnly(id: string, selectable = true) {
    setSelected(selectable ? new Set([id]) : new Set());
    setAnchorId(selectable ? id : null);
    setFocusId(id);
  }

  /** The marquee's result: replace the selection, focusing the last row it reached. */
  function selectIds(ids: string[]) {
    setSelected(new Set(ids));
    setAnchorId(ids[0] ?? null);
    setFocusId(ids[ids.length - 1] ?? null);
  }

  function selectWithModifier(id: string, mode: "toggle" | "range", poolIds: string[]) {
    if (mode === "toggle") {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchorId(id);
    } else {
      const a = poolIds.indexOf(anchorId!);
      const b = poolIds.indexOf(id);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      setSelected(new Set(poolIds.slice(lo, hi + 1)));
    }
    setFocusId(id);
    followRow(id);
  }

  /** Right-click: focus the row, and select it alone unless it is already part of the selection. */
  function handleContextSelect(id: string) {
    setFocusId(id);
    if (!selected.has(id)) {
      setSelected(new Set([id]));
      setAnchorId(id);
    }
    followRow(id);
  }

  const revealedRef = useRef(false);
  useEffect(() => {
    if (!initialSelectedId || revealedRef.current) return;
    revealedRef.current = true;
    if (!itemIndex.has(initialSelectedId)) return;
    focusOnly(initialSelectedId);
    followRow(initialSelectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedId, itemIndex]);

  const revealedIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!revealId || revealedIdRef.current === revealId || !itemIndex.has(revealId)) return;
    revealedIdRef.current = revealId;
    focusOnly(revealId);
    followRow(revealId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealId, itemIndex]);

  return {
    selected,
    setSelected,
    anchorId,
    focusId,
    focusEntry,
    selectedItems,
    clearSelection,
    focusOnly,
    selectIds,
    selectWithModifier,
    handleContextSelect,
  };
}
