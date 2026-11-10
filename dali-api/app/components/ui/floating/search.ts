import type { SelectOption } from "./Select";

export const SEARCH_THRESHOLD = 8;

export function matchesQuery(option: SelectOption<string>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    option.label.toLowerCase().includes(q) ||
    (option.description?.toLowerCase().includes(q) ?? false)
  );
}
