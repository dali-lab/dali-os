import {
  isMemberHistoryColumn,
  type MemberHistoryColumn,
} from "~/projects/lib/member-history";

const MEMBER_PREFIX = "member:";

export function responseColumnId(key: MemberHistoryColumn): string {
  return `${MEMBER_PREFIX}${key}`;
}

export function memberColumnKey(id: string): MemberHistoryColumn | null {
  if (!id.startsWith(MEMBER_PREFIX)) return null;
  const key = id.slice(MEMBER_PREFIX.length);
  return isMemberHistoryColumn(key) ? key : null;
}

export function parseResponseColumns(json: unknown): MemberHistoryColumn[] {
  if (!Array.isArray(json)) return [];
  const keys: MemberHistoryColumn[] = [];
  for (const id of json) {
    const key = typeof id === "string" ? memberColumnKey(id) : null;
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Strict form of parseResponseColumns for writes: null when anything in the
// list isn't a known column id.
export function validResponseColumns(json: unknown): MemberHistoryColumn[] | null {
  if (!Array.isArray(json)) return null;
  if (!json.every((id) => typeof id === "string" && memberColumnKey(id))) return null;
  return parseResponseColumns(json);
}
