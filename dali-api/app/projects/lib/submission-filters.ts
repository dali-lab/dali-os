// Column filters for the People directory and the form-bound submission boards
// (Intent to Work, Project Bids, Level Up). Pure and client-safe: rows already
// carry their resolved cell strings, so filtering is string comparison against
// those.
//
// A filter is a column plus the values picked for it: values within a column
// OR together (a row matches on any of them), columns AND together.

export type ColumnFilter = {
  columnKey: string;
  values: string[];
};

// A cell is one string, or a list when the column holds several values per row
// (a member's domains). A list matches a picked value on any of its entries,
// so filtering Domain to Design finds someone who is also in Engineering.
export type FilterCell = string | readonly string[];
export type FilterCells = Record<string, FilterCell | undefined>;

export function cellValues(cell: FilterCell | undefined): string[] {
  const list = cell === undefined ? [] : typeof cell === "string" ? [cell] : cell;
  return list.map((v) => v.trim()).filter((v) => v !== "");
}

// Filters that can actually run: the column still exists on this board (a term
// switch can change the mapping) and at least one value is picked.
export function applicableFilters(
  filters: readonly ColumnFilter[],
  columnKeys: readonly string[],
): ColumnFilter[] {
  return filters.filter(
    (f) => columnKeys.includes(f.columnKey) && f.values.length > 0,
  );
}

export function matchesFilters(
  cells: FilterCells,
  filters: readonly ColumnFilter[],
): boolean {
  return filters.every((f) =>
    cellValues(cells[f.columnKey]).some((v) => f.values.includes(v)),
  );
}

/** The values picked for one column; `[]` when the column has no filter. */
export function filterValues(
  filters: readonly ColumnFilter[],
  columnKey: string,
): string[] {
  return filters.find((f) => f.columnKey === columnKey)?.values ?? [];
}

/** Toggle one value on a column; a column whose last value is removed is dropped. */
export function toggleFilterValue(
  filters: readonly ColumnFilter[],
  columnKey: string,
  value: string,
): ColumnFilter[] {
  const current = filterValues(filters, columnKey);
  const values = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  if (values.length === 0) return clearFilterColumn(filters, columnKey);
  if (current.length === 0) return [...filters, { columnKey, values }];
  return filters.map((f) => (f.columnKey === columnKey ? { columnKey, values } : f));
}

export function clearFilterColumn(
  filters: readonly ColumnFilter[],
  columnKey: string,
): ColumnFilter[] {
  return filters.filter((f) => f.columnKey !== columnKey);
}

/**
 * The value picker's options. A column with a natural order (terms) passes
 * `order`: every listed value shows in that order, row or not, and any other
 * response follows sorted. Otherwise the distinct responses, sorted.
 */
export function columnResponses(
  rows: readonly { cells: FilterCells }[],
  columnKey: string,
  order?: readonly string[],
): string[] {
  const values = new Set<string>();
  for (const r of rows) {
    for (const v of cellValues(r.cells[columnKey])) values.add(v);
  }
  const rest = [...values]
    .filter((v) => !order?.includes(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return [...(order ?? []), ...rest];
}
