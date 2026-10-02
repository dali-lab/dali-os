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

function matches(cell: string, f: ColumnFilter): boolean {
  switch (f.operator) {
    case "is":
      return cell === f.value;
    case "isNot":
      return cell !== f.value;
    case "contains":
      return cell.toLowerCase().includes(f.value.trim().toLowerCase());
    case "notContains":
      return !cell.toLowerCase().includes(f.value.trim().toLowerCase());
    case "isEmpty":
      return cell === "";
    case "isNotEmpty":
      return cell !== "";
  }
}

/** All filters must pass (AND). */
export function matchesFilters(
  cells: Record<string, string>,
  filters: readonly ColumnFilter[],
): boolean {
  return filters.every((f) => matches((cells[f.columnKey] ?? "").trim(), f));
}

/** Distinct non-empty responses in a column, sorted, for the value dropdown. */
export function columnResponses(
  rows: readonly { cells: Record<string, string> }[],
  columnKey: string,
): string[] {
  const values = new Set<string>();
  for (const r of rows) {
    const v = (r.cells[columnKey] ?? "").trim();
    if (v) values.add(v);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}
