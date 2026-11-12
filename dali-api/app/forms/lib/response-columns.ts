import {
  MEMBER_HISTORY_COLUMNS,
  isMemberHistoryColumn,
  type MemberHistoryColumn,
} from "~/projects/lib/member-history";
import { moveAmongVisible, type ColumnOp } from "./column-ops";

const MEMBER_PREFIX = "member:";

// One saved results column: a question key or "member:<column>", with an
// optional renamed label. Saved in table order on Form.responseColumns.
export type ResultColumnEntry = { id: string; label?: string; hidden?: boolean };

export type TableColumn = { key: string; label: string };

export function responseColumnId(key: MemberHistoryColumn): string {
  return `${MEMBER_PREFIX}${key}`;
}

export function memberColumnKey(id: string): MemberHistoryColumn | null {
  if (!id.startsWith(MEMBER_PREFIX)) return null;
  const key = id.slice(MEMBER_PREFIX.length);
  return isMemberHistoryColumn(key) ? key : null;
}

const memberLabel = (key: MemberHistoryColumn) =>
  MEMBER_HISTORY_COLUMNS.find((c) => c.key === key)!.label;

// Older saves are a plain list of member ids.
export function parseResultColumns(json: unknown): ResultColumnEntry[] {
  if (!Array.isArray(json)) return [];
  const out: ResultColumnEntry[] = [];
  for (const raw of json) {
    const e = typeof raw === "string" ? { id: raw } : (raw as Record<string, unknown> | null);
    if (!e || typeof e.id !== "string" || e.id === "") continue;
    if (e.id.startsWith(MEMBER_PREFIX) && !memberColumnKey(e.id)) continue;
    if (out.some((o) => o.id === e.id)) continue;
    out.push({
      id: e.id,
      ...(typeof e.label === "string" && e.label ? { label: e.label } : {}),
      ...(e.hidden === true ? { hidden: true } : {}),
    });
  }
  return out;
}

// Every column the table can show, in order: saved entries that still exist
// for these questions, plus questions the save doesn't mention yet. Questions
// lead when the save names none (a member-only list from before columns could
// move).
function orderedEntries(
  config: readonly ResultColumnEntry[],
  questions: readonly TableColumn[],
): ResultColumnEntry[] {
  const qKeys = new Set(questions.map((q) => q.key));
  const known = config.filter((e) => memberColumnKey(e.id) || qKeys.has(e.id));
  const placed = new Set(known.map((e) => e.id));
  const rest = questions.filter((q) => !placed.has(q.key)).map((q) => ({ id: q.key }));
  return known.some((e) => qKeys.has(e.id)) ? [...known, ...rest] : [...rest, ...known];
}

export function arrangeResultColumns(
  questions: readonly TableColumn[],
  config: readonly ResultColumnEntry[],
): { visible: TableColumn[]; hidden: TableColumn[]; members: MemberHistoryColumn[] } {
  const qLabel = new Map(questions.map((q) => [q.key, q.label]));
  const entries = orderedEntries(config, questions);
  const column = (e: ResultColumnEntry): TableColumn => {
    const member = memberColumnKey(e.id);
    return { key: e.id, label: e.label ?? (member ? memberLabel(member) : qLabel.get(e.id)!) };
  };
  const shown = entries.filter((e) => !e.hidden);
  const unplacedMembers = MEMBER_HISTORY_COLUMNS.filter(
    (c) => !entries.some((e) => e.id === responseColumnId(c.key)),
  ).map((c) => ({ key: responseColumnId(c.key), label: c.label }));
  return {
    visible: shown.map(column),
    hidden: [...entries.filter((e) => e.hidden).map(column), ...unplacedMembers],
    members: shown.flatMap((e) => memberColumnKey(e.id) ?? []),
  };
}

// The saved list after one change, or null when the op doesn't apply (an
// unknown column, or a staffing role, which results don't have).
export function applyResultColumnOp(
  config: readonly ResultColumnEntry[],
  op: ColumnOp,
  questions: readonly TableColumn[],
): ResultColumnEntry[] | null {
  if (op.op === "role") return null;
  const entries = orderedEntries(config, questions);
  const i = entries.findIndex((e) => e.id === op.id);
  if (i < 0) {
    return op.op === "show" && memberColumnKey(op.id) ? [...entries, { id: op.id }] : null;
  }
  const without = entries.filter((_, j) => j !== i);
  const e = entries[i];
  switch (op.op) {
    case "show": {
      const { hidden: _hidden, ...shown } = e;
      return [...without, shown];
    }
    case "hide":
      return entries.map((x, j) => (j === i ? { ...x, hidden: true } : x));
    case "rename":
      return entries.map((x, j) => {
        if (j !== i) return x;
        const { label: _label, ...rest } = x;
        return op.label ? { ...rest, label: op.label } : rest;
      });
    case "move":
      return moveAmongVisible(entries, i, op.dir, (x) => !x.hidden);
  }
}
