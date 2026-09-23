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
