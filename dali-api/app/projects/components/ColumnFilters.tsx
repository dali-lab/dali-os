// Filter bar for the People directory and the form-bound submission boards.
// One Filter button opens a two-stage menu (pick a column, then pick values);
// each filtered column becomes a pill with its own value dropdown and remove
// control. Values within a column OR together, columns AND. Presentational:
// the parent owns the filter list and applies it (see submission-filters.ts).

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { LucideIcon } from "lucide-react";
import { FilterBar, type FilterBarColumn } from "~/components/FilterBar";
import { MultiSelectList, type MultiSelectOption } from "~/components/ui/floating";
import {
  applicableFilters,
  cellValues,
  clearFilterColumn,
  columnResponses,
  filterValues,
  hasFilterParams,
  matchesFilters,
  readFilterParams,
  toggleFilterValue,
  writeFilterParams,
  type ColumnFilter,
  type FilterCells,
} from "../lib/submission-filters";

export type FilterColumn = {
  key: string;
  label: string;
  icon?: LucideIcon;
  // Option order when alphabetical is wrong for the column (terms, newest first).
  order?: readonly string[];
  // Display text for an option; the value itself is what rows are matched on.
  optionLabel?: (value: string) => string;
};

// Filter state for a board plus the row predicate to hand useFilteredList
// (put `active` in its `deps`). With inUrl the filters live in `f.*` search
// params, so the view survives reload and the back button; `initial` applies
// while the URL says nothing about filters.
export function useColumnFilters(
  columns: { key: string }[],
  initial: ColumnFilter[] = [],
  { inUrl = false }: { inUrl?: boolean } = {},
) {
  const [localFilters, setLocalFilters] = useState<ColumnFilter[]>(initial);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFilters = useMemo(
    () => (hasFilterParams(searchParams) ? readFilterParams(searchParams) : null),
    [searchParams],
  );
  const filters = inUrl ? (urlFilters ?? initial) : localFilters;
  const hasDefaults = initial.length > 0;
  const setFilters = useCallback(
    (next: ColumnFilter[]) => {
      if (!inUrl) return setLocalFilters(next);
      setSearchParams((prev) => writeFilterParams(prev, next, { markEmpty: hasDefaults }), {
        replace: true,
        preventScrollReset: true,
      });
    },
    [inUrl, hasDefaults, setSearchParams],
  );
  const active = useMemo(
    () => applicableFilters(filters, columns.map((c) => c.key)),
    [filters, columns],
  );
  const predicate = (row: { cells: FilterCells }) => matchesFilters(row.cells, active);
  return { filters, setFilters, active, predicate };
}

export function ColumnFilters({
  columns,
  rows,
  filters,
  onChange,
  shownCount,
  noun = ["row", "rows"],
}: {
  columns: FilterColumn[];
  // Unfiltered rows: the value picker offers every response in the column.
  rows: readonly { cells: FilterCells }[];
  filters: ColumnFilter[];
  onChange: (next: ColumnFilter[]) => void;
  // Rows left after search and every filter on the board.
  shownCount: number;
  // What a row is called in the count. Defaults to "row"/"rows".
  noun?: [singular: string, plural: string];
}) {
  const columnKeys = columns.map((c) => c.key);

  // How many rows an option would show, given every other column's filter.
  const countFor = (key: string, option: string) => {
    const others = applicableFilters(filters, columnKeys).filter((f) => f.columnKey !== key);
    return rows.filter(
      (r) => matchesFilters(r.cells, others) && cellValues(r.cells[key]).includes(option),
    ).length;
  };

  const barColumns: FilterBarColumn[] = columns.map((col) => {
    const selected = filterValues(filters, col.key);
    const labels = selected.map(col.optionLabel ?? ((v) => v));
    const onClear = () => onChange(clearFilterColumn(filters, col.key));
    return {
      key: col.key,
      label: col.label,
      icon: col.icon,
      count: selected.length,
      summary: labels.length <= 2 ? labels.join(", ") : `${labels[0]} +${labels.length - 1}`,
      detail: labels.join(", "),
      onClear,
      renderPicker: ({ autoFocus }) => (
        <MultiSelectList
          values={selected}
          options={valueOptions(col, columnResponses(rows, col.key, col.order), countFor)}
          onToggle={(v) => onChange(toggleFilterValue(filters, col.key, v))}
          onClear={onClear}
          clearLabel={`Clear ${col.label.toLowerCase()}`}
          ariaLabel={col.label}
          searchPlaceholder={`Search ${col.label.toLowerCase()}`}
          autoFocus={autoFocus}
        />
      ),
    };
  });

  return (
    <FilterBar
      columns={barColumns}
      onClearAll={() => onChange([])}
      count={`${shownCount === rows.length ? rows.length : `${shownCount} of ${rows.length}`} ${
        rows.length === 1 ? noun[0] : noun[1]
      }`}
    />
  );
}

function valueOptions(
  column: FilterColumn,
  options: string[],
  countFor: (key: string, option: string) => number,
): MultiSelectOption[] {
  const labelOf = column.optionLabel ?? ((v: string) => v);
  return options.map((opt) => ({
    value: opt,
    label: labelOf(opt),
    trailing: (
      <span className="ml-auto pl-2 text-xs tabular-nums text-os-muted">{countFor(column.key, opt)}</span>
    ),
  }));
}
