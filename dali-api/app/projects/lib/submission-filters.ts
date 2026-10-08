// Column filters for the form-bound submission boards (Intent to Work, Project
// Bids, Level Up). Pure and client-safe: rows already carry their resolved cell
// strings, so filtering is string comparison against those.

export const FILTER_OPERATORS = [
  { value: "is", label: "is" },
  { value: "isNot", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "notContains", label: "does not contain" },
  { value: "isEmpty", label: "is empty" },
  { value: "isNotEmpty", label: "is not empty" },
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number]["value"];

export type ColumnFilter = {
  id: string;
  columnKey: string;
  operator: FilterOperator;
  value: string;
};

// A cell is one string, or a list when the column holds several values per row
// (a member's domains). A list matches `is` when any entry is the value, so
// "Domain is Design" finds someone who is also in Engineering.
export type FilterCell = string | readonly string[];
export type FilterCells = Record<string, FilterCell | undefined>;

function cellValues(cell: FilterCell | undefined): string[] {
  const list = cell === undefined ? [] : typeof cell === "string" ? [cell] : cell;
  return list.map((v) => v.trim()).filter((v) => v !== "");
}

export function operatorNeedsValue(op: FilterOperator): boolean {
  return op !== "isEmpty" && op !== "isNotEmpty";
}

/** `is` / `is not` pick from existing responses; the text operators take free text. */
export function operatorPicksResponse(op: FilterOperator): boolean {
  return op === "is" || op === "isNot";
}

// Filters that can actually run: the column still exists on this board (a term
// switch can change the mapping) and a value has been chosen where one is
// needed. A half-built row filters nothing rather than hiding every row.
export function applicableFilters(
  filters: readonly ColumnFilter[],
  columnKeys: readonly string[],
): ColumnFilter[] {
  return filters.filter(
    (f) =>
      columnKeys.includes(f.columnKey) &&
      (!operatorNeedsValue(f.operator) || f.value.trim() !== ""),
  );
}

function matches(values: string[], f: ColumnFilter): boolean {
  const needle = f.value.trim().toLowerCase();
  const has = () => values.some((v) => v.toLowerCase().includes(needle));
  switch (f.operator) {
    case "is":
      return values.includes(f.value);
    case "isNot":
      return !values.includes(f.value);
    case "contains":
      return has();
    case "notContains":
      return !has();
    case "isEmpty":
      return values.length === 0;
    case "isNotEmpty":
      return values.length > 0;
  }
}

/** All filters must pass (AND). */
export function matchesFilters(
  cells: FilterCells,
  filters: readonly ColumnFilter[],
): boolean {
  return filters.every((f) => matches(cellValues(cells[f.columnKey]), f));
}

/** Distinct non-empty responses in a column, sorted, for the value dropdown. */
export function columnResponses(
  rows: readonly { cells: FilterCells }[],
  columnKey: string,
): string[] {
  const values = new Set<string>();
  for (const r of rows) {
    for (const v of cellValues(r.cells[columnKey])) values.add(v);
  }
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
