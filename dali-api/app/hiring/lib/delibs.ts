// Shared delibs helpers. A board's columns come from its round's place in the
// cycle's timeline (cycle-timeline.ts delibRounds).

// Normalize a (possibly partial) saved column order into a full board layout.
// The server only persists cards that have been moved, so `savedOrder` omits
// never-moved applications. This keeps only IDs in the loaded universe, dedupes
// across columns, and sweeps any un-placed application into the default column,
// so both the initial render and the post-move reconciliation produce the same
// shape and no card silently disappears.
export function buildColumnOrder(
  savedOrder: Record<string, string[]> | null | undefined,
  applicationIds: Iterable<string>,
  columns: readonly string[],
  defaultColumn: string,
): Record<string, string[]> {
  const universe = new Set(applicationIds);
  const saved = savedOrder ?? {};
  const placed = new Set<string>();
  const order: Record<string, string[]> = {};

  for (const col of columns) {
    order[col] = [];
    for (const id of saved[col] ?? []) {
      if (universe.has(id) && !placed.has(id)) {
        order[col].push(id);
        placed.add(id);
      }
    }
  }

  for (const id of universe) {
    if (!placed.has(id)) {
      order[defaultColumn].push(id);
      placed.add(id);
    }
  }

  return order;
}

// Where a dragged card lands. `overId` is a column id (dropped on the column
// shell: append) or a card id (dropped on a card: take its slot).
export function dropCard(
  order: Record<string, string[]>,
  cardId: string,
  overId: string,
  columns: readonly string[],
): { order: Record<string, string[]>; toColumn: string } | null {
  const toColumn = columns.includes(overId)
    ? overId
    : columns.find((col) => (order[col] ?? []).includes(overId));
  if (!toColumn || overId === cardId) return null;

  const fromColumn = columns.find((col) => (order[col] ?? []).includes(cardId));
  const next: Record<string, string[]> = {};
  for (const col of columns) next[col] = (order[col] ?? []).filter((id) => id !== cardId);

  const target = next[toColumn];
  if (overId === toColumn) {
    target.push(cardId);
  } else {
    const overIndex = target.indexOf(overId);
    // Dragging down within a column lands after the hovered card, matching
    // the sortable preview (arrayMove semantics).
    const sameColumnDown =
      fromColumn === toColumn && (order[toColumn] ?? []).indexOf(cardId) < (order[toColumn] ?? []).indexOf(overId);
    target.splice(sameColumnDown ? overIndex + 1 : overIndex, 0, cardId);
  }

  if (fromColumn === toColumn && next[toColumn].join() === (order[toColumn] ?? []).join()) return null;
  return { order: next, toColumn };
}

// Server side of a move. `visibleOrder` is the target column as the mover saw
// it after the drop; it can name never-moved cards the saved order lacks. Cards
// another lead has since moved elsewhere are dropped from it, and cards another
// lead has since moved in are kept at the end.
export function applyMove(
  current: Record<string, string[]>,
  columns: readonly string[],
  cardId: string,
  toColumn: string,
  visibleOrder?: readonly string[],
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const col of columns) next[col] = (current[col] ?? []).filter((id) => id !== cardId);

  const serverTarget = next[toColumn];
  if (!visibleOrder?.includes(cardId)) {
    next[toColumn] = [...serverTarget, cardId];
    return next;
  }

  const elsewhere = new Set(columns.filter((col) => col !== toColumn).flatMap((col) => next[col]));
  const merged = [...new Set(visibleOrder)].filter((id) => id === cardId || !elsewhere.has(id));
  const seen = new Set(merged);
  next[toColumn] = [...merged, ...serverTarget.filter((id) => !seen.has(id))];
  return next;
}
