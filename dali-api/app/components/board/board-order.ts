// Column ordering shared by every kanban that persists a manual order
// (task board, partner CRM). Cards carry a `status` (column key) and a
// `position` (dense 0..n inside the column after a move; gaps are tolerated).

export type Positioned<S extends string> = {
  id: string;
  status: S;
  position: number;
};

export type Board<S extends string, T> = Record<S, T[]>;

/**
 * Group cards into columns keyed by status, each ordered by `position`.
 * Stable: input order is the tiebreaker, so callers pass cards already ordered
 * by createdAt. A card whose status is not a known column lands in `fallback`
 * rather than vanishing.
 */
export function buildBoard<S extends string, T extends Positioned<S>>(
  cards: T[],
  statuses: readonly S[],
  fallback: S,
): Board<S, T> {
  const board = Object.fromEntries(statuses.map((s) => [s, [] as T[]])) as Board<S, T>;
  for (const card of cards) {
    const col = board[card.status] ? card.status : fallback;
    board[col].push(card);
  }
  for (const status of statuses) {
    board[status].sort((a, b) => a.position - b.position);
  }
  return board;
}

/**
 * Position for a card appended to the end of a column: one past the current
 * maximum, or 0 when the column is empty.
 */
export function nextPositionInColumn<S extends string, T extends Positioned<S>>(
  board: Board<S, T>,
  status: S,
): number {
  const col = board[status] ?? [];
  if (col.length === 0) return 0;
  return Math.max(...col.map((c) => c.position)) + 1;
}

/**
 * Move `cardId` into `toStatus` at `targetIndex` (clamped; -1 or >= length
 * appends). Returns the updated flat card list, with the target column
 * renumbered 0..n so ordering is dense, plus that column's ordered ids, which
 * is the `orderedIds` payload the move APIs take.
 */
export function moveInBoard<S extends string, T extends Positioned<S>>(
  cards: T[],
  cardId: string,
  toStatus: S,
  targetIndex: number,
  statuses: readonly S[],
  fallback: S,
): { cards: T[]; orderedIds: string[] } {
  const moved = cards.find((c) => c.id === cardId);
  if (!moved) return { cards, orderedIds: [] };

  const column = buildBoard(cards, statuses, fallback)[toStatus].filter((c) => c.id !== cardId);
  const index = targetIndex < 0 || targetIndex > column.length ? column.length : targetIndex;
  column.splice(index, 0, { ...moved, status: toStatus });

  const positionById = new Map(column.map((c, i) => [c.id, i]));
  return {
    cards: cards.map((c) => {
      const position = positionById.get(c.id);
      if (position === undefined) return c;
      return { ...c, status: toStatus, position };
    }),
    orderedIds: column.map((c) => c.id),
  };
}
