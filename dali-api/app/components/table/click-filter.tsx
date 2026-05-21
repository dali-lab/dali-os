import { useCallback, useState, type ReactNode } from "react";

// A reusable "click a cell value to filter the table" mechanism shared across
// the directory-style tables (projects, members, partner applications, hiring
// analytics). Filters are kept in local component state and applied
// client-side on top of each table's existing search box — the data for these
// tables is already fully loaded, so there's no loader round-trip.

export type ActiveFilter = {
  // The logical column this filter targets, e.g. "status" or "partner".
  column: string;
  // The exact value matched against the row's value(s) for that column.
  value: string;
  // Human-readable text shown in the active-filter chip.
  label: string;
};

// A row's value(s) for each filterable column. A column may be single- or
// multi-valued; null/undefined means the row has no value there.
export type RowValues = Record<string, string | string[] | null | undefined>;

// Pure matcher: within a single column the active values are OR'd (a row
// matches if it has any of them); across columns they're AND'd (the row must
// satisfy every filtered column). Exported standalone so it can be unit tested
// without React.
export function matchesActiveFilters(
  filters: ActiveFilter[],
  rowValues: RowValues,
): boolean {
  if (filters.length === 0) return true;

  const wantedByColumn = new Map<string, Set<string>>();
  for (const f of filters) {
    let set = wantedByColumn.get(f.column);
    if (!set) {
      set = new Set();
      wantedByColumn.set(f.column, set);
    }
    set.add(f.value);
  }

  for (const [column, wanted] of wantedByColumn) {
    const raw = rowValues[column];
    const have = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    if (!have.some((v) => wanted.has(v))) return false;
  }
  return true;
}

export type TableFilters = ReturnType<typeof useTableFilters>;

export function useTableFilters() {
  const [filters, setFilters] = useState<ActiveFilter[]>([]);

  const toggle = useCallback((f: ActiveFilter) => {
    setFilters((prev) => {
      const exists = prev.some(
        (p) => p.column === f.column && p.value === f.value,
      );
      return exists
        ? prev.filter((p) => !(p.column === f.column && p.value === f.value))
        : [...prev, f];
    });
  }, []);

  const remove = useCallback((column: string, value: string) => {
    setFilters((prev) =>
      prev.filter((p) => !(p.column === column && p.value === value)),
    );
  }, []);

  const clear = useCallback(() => setFilters([]), []);

  const isActive = useCallback(
    (column: string, value: string) =>
      filters.some((p) => p.column === column && p.value === value),
    [filters],
  );

  const matches = useCallback(
    (rowValues: RowValues) => matchesActiveFilters(filters, rowValues),
    [filters],
  );

  return { active: filters, toggle, remove, clear, isActive, matches };
}

// Renders a table cell value as an inline toggle button. Clicking it adds (or
// removes) the corresponding filter. stopPropagation keeps the click from
// reaching a row-level navigate handler, so the row's detail link still works
// everywhere else in the row.
export function FilterableValue({
  filters,
  column,
  value,
  label,
  className = "",
  activeClassName = "ring-1 ring-accent-coral/70",
  children,
}: {
  filters: TableFilters;
  column: string;
  value: string;
  label?: string;
  className?: string;
  activeClassName?: string;
  children?: ReactNode;
}) {
  const active = filters.isActive(column, value);
  const text = label ?? value;
  return (
    <button
      type="button"
      aria-pressed={active}
      title={active ? `Remove filter: ${text}` : `Filter by ${text}`}
      onClick={(e) => {
        e.stopPropagation();
        filters.toggle({ column, value, label: text });
      }}
      className={`text-left align-middle transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/50 ${
        active ? activeClassName : ""
      } ${className}`}
    >
      {children ?? text}
    </button>
  );
}

// A bar of removable chips for the currently active filters, with a "Clear
// all" affordance once more than one is set. Renders nothing when empty.
export function ActiveFilters({
  filters,
  className = "",
}: {
  filters: TableFilters;
  className?: string;
}) {
  if (filters.active.length === 0) return null;
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      <span className="text-xs text-muted-foreground">Filtering by:</span>
      {filters.active.map((f) => (
        <button
          key={`${f.column}::${f.value}`}
          type="button"
          onClick={() => filters.remove(f.column, f.value)}
          aria-label={`Remove filter: ${f.label}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-accent-coral/10 text-accent-coral hover:bg-accent-coral/20 transition-colors"
        >
          <span>{f.label}</span>
          <span aria-hidden="true">×</span>
        </button>
      ))}
      {filters.active.length > 1 && (
        <button
          type="button"
          onClick={filters.clear}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
