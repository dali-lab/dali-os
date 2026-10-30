export interface KeysetCursor {
  at: string;
  id: string;
}

export function parsePageParam(raw: string | null | undefined): number {
  const page = Math.floor(Number(raw ?? "1"));
  return Number.isFinite(page) && page >= 1 ? page : 1;
}

export function offsetWindow(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize + 1 };
}

export function offsetPage<T>(rows: T[], pageSize: number): { items: T[]; hasNext: boolean } {
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
}

export function encodeCursor(cursor: KeysetCursor): string {
  return `${cursor.at}|${cursor.id}`;
}

// A malformed cursor is client-supplied, so it reads as the first page.
export function decodeCursor(raw: string | null | undefined): KeysetCursor | null {
  if (!raw) return null;
  const split = raw.indexOf("|");
  if (split <= 0) return null;
  const at = raw.slice(0, split);
  const id = raw.slice(split + 1);
  if (!id || Number.isNaN(new Date(at).getTime())) return null;
  return { at, id };
}

export function keysetPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => KeysetCursor,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
}

// The where clause for a (field desc, id desc) keyset. The sort must use `id`
// as its tiebreak, and `field` must be non-null on every row in the query.
export function keysetAfter<F extends string>(field: F, cursor: KeysetCursor | null) {
  if (!cursor) return {};
  const at = new Date(cursor.at);
  return {
    OR: [{ [field]: { lt: at } }, { [field]: at, id: { lt: cursor.id } }],
  } as { OR: Array<Record<string, unknown>> };
}
