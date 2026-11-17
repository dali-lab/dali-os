// One change to a responses table's columns, sent from the header's + button
// and column menu. Form results and the staffing boards apply the same ops to
// their own stores (Form.responseColumns, the binding's column mapping).
export type ColumnOp =
  | { op: "show"; id: string }
  | { op: "hide"; id: string }
  | { op: "rename"; id: string; label: string }
  | { op: "move"; id: string; dir: -1 | 1 }
  | { op: "role"; id: string; role: string; termId: string | null }
  | { op: "statusMap"; id: string; statusMap: Record<string, string> };

export const MAX_COLUMN_LABEL = 120;

export function parseColumnOp(json: unknown): ColumnOp | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id === "") return null;
  switch (o.op) {
    case "show":
    case "hide":
      return { op: o.op, id: o.id };
    case "rename":
      return typeof o.label === "string" && o.label.length <= MAX_COLUMN_LABEL
        ? { op: "rename", id: o.id, label: o.label.trim() }
        : null;
    case "move":
      return o.dir === 1 || o.dir === -1 ? { op: "move", id: o.id, dir: o.dir } : null;
    case "role":
      return typeof o.role === "string" &&
        (o.termId === undefined || o.termId === null || typeof o.termId === "string")
        ? { op: "role", id: o.id, role: o.role, termId: (o.termId as string | null | undefined) || null }
        : null;
    case "statusMap": {
      const m = o.statusMap;
      if (!m || typeof m !== "object" || Array.isArray(m)) return null;
      const entries = Object.entries(m as Record<string, unknown>);
      if (entries.length > 500 || !entries.every(([, v]) => typeof v === "string")) return null;
      return { op: "statusMap", id: o.id, statusMap: Object.fromEntries(entries) as Record<string, string> };
    }
    default:
      return null;
  }
}

// Swap an item with its nearest visible neighbour in `dir`. Hidden items keep
// their place, so showing one later puts it back where it was.
export function moveAmongVisible<T>(
  items: readonly T[],
  index: number,
  dir: -1 | 1,
  visible: (item: T) => boolean,
): T[] {
  let j = index + dir;
  while (j >= 0 && j < items.length && !visible(items[j])) j += dir;
  if (j < 0 || j >= items.length) return [...items];
  const next = [...items];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}
