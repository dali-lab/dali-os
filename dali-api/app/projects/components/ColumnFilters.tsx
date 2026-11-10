// Filter bar for the People directory and the form-bound submission boards.
// One Filter button opens a two-stage menu (pick a column, then pick values);
// each filtered column becomes a pill with its own value dropdown and remove
// control. Values within a column OR together, columns AND. Presentational:
// the parent owns the filter list and applies it (see submission-filters.ts).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useSearchParams } from "react-router";
import { ChevronDown, ChevronRight, ListFilter, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { MultiSelect, MultiSelectList, toggledValue, type MultiSelectOption } from "~/components/ui/floating";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import { cn } from "~/lib/cn";
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

function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, ref]);
}

const MENU_CLASS = cn(
  "absolute left-0 top-full z-30 mt-1.5 origin-top-left motion-safe:animate-area-menu",
  OS_SURFACE_CLASS,
);

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
  const [addOpen, setAddOpen] = useState(false);
  const [addStage, setAddStage] = useState<FilterColumn | null>(null);
  const addRef = useRef<HTMLDivElement>(null);

  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setAddStage(null);
  }, []);
  useDismiss(addRef, addOpen, closeAdd);

  const columnKeys = columns.map((c) => c.key);
  const activeColumns = columns.filter((c) => filterValues(filters, c.key).length > 0);
  const activeCount = activeColumns.reduce(
    (n, c) => n + filterValues(filters, c.key).length,
    0,
  );

  // How many rows an option would show, given every other column's filter.
  const countFor = (key: string, option: string) => {
    const others = applicableFilters(filters, columnKeys).filter((f) => f.columnKey !== key);
    return rows.filter(
      (r) => matchesFilters(r.cells, others) && cellValues(r.cells[key]).includes(option),
    ).length;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div ref={addRef} className="relative">
        <Button
          size="sm"
          variant="secondary"
          // No columns yet (no form bound, or nothing mapped): keep the bar
          // and count so the toolbar reads the same on every board, with the
          // button inert rather than opening an empty menu.
          disabled={columns.length === 0}
          title={columns.length === 0 ? "No columns to filter yet" : undefined}
          onClick={() => (addOpen ? closeAdd() : setAddOpen(true))}
          aria-haspopup="menu"
          aria-expanded={addOpen}
          className={cn("h-8", addOpen && "border-os-container-hi bg-os-hover")}
        >
          <ListFilter className="h-4 w-4" aria-hidden />
          Filter
          {activeCount > 0 && (
            <span className="-mr-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-os-accent px-1.5 text-xs font-bold text-os-bg">
              {activeCount}
            </span>
          )}
        </Button>
        {addOpen && !addStage && (
          <div role="menu" className={cn(MENU_CLASS, "w-56 p-1.5")}>
            <p className="px-2.5 pb-1 pt-1 text-xs font-semibold text-os-muted">Filter by</p>
            {columns.map((col) => {
              const n = filterValues(filters, col.key).length;
              return (
                <button
                  key={col.key}
                  type="button"
                  role="menuitem"
                  onClick={() => setAddStage(col)}
                  className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-os-hover focus-visible:bg-os-hover focus-visible:outline-none"
                >
                  {col.icon && <col.icon className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />}
                  <span className="truncate">{col.label}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {n > 0 && <span className="text-xs font-semibold text-os-accent">{n}</span>}
                    <ChevronRight className="h-3.5 w-3.5 text-os-muted" aria-hidden />
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {addOpen && addStage && (
          <FilterValuePicker
            key={addStage.key}
            column={addStage}
            selected={filterValues(filters, addStage.key)}
            options={columnResponses(rows, addStage.key, addStage.order)}
            countFor={countFor}
            onToggle={(v) => onChange(toggleFilterValue(filters, addStage.key, v))}
            onClear={() => onChange(clearFilterColumn(filters, addStage.key))}
            onBack={() => setAddStage(null)}
          />
        )}
      </div>

      {activeColumns.length > 0 && <span className="mx-0.5 h-5 w-px bg-os-container" aria-hidden />}

      {activeColumns.map((col) => (
        <FilterPill
          key={col.key}
          column={col}
          selected={filterValues(filters, col.key)}
          options={columnResponses(rows, col.key, col.order)}
          countFor={countFor}
          onToggle={(v) => onChange(toggleFilterValue(filters, col.key, v))}
          onClear={() => onChange(clearFilterColumn(filters, col.key))}
        />
      ))}
      {activeColumns.length > 0 && (
        <Button variant="ghost" size="sm" className="h-8" onClick={() => onChange([])}>
          Clear all
        </Button>
      )}

      <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
        {shownCount === rows.length ? rows.length : `${shownCount} of ${rows.length}`}{" "}
        {rows.length === 1 ? noun[0] : noun[1]}
      </p>
    </div>
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

function FilterPill({
  column,
  selected,
  options,
  countFor,
  onToggle,
  onClear,
}: {
  column: FilterColumn;
  selected: string[];
  options: string[];
  countFor: (key: string, option: string) => number;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const labels = selected.map(column.optionLabel ?? ((v) => v));
  const summary =
    labels.length <= 2 ? labels.join(", ") : `${labels[0]} +${labels.length - 1}`;

  return (
    <div className="flex h-8 items-center overflow-hidden rounded-lg border border-os-container bg-os-card text-sm transition-colors">
      <span className="flex h-full items-center gap-1.5 pl-2.5 pr-2 text-os-grey">
        {column.icon && <column.icon className="h-3.5 w-3.5" aria-hidden />}
        {column.label}
      </span>
      <MultiSelect
        values={selected}
        onChange={(next) => {
          if (next.length === 0) return onClear();
          const changed = toggledValue(selected, next);
          if (changed) onToggle(changed);
        }}
        options={valueOptions(column, options, countFor)}
        searchable
        chips={false}
        ariaLabel={`${column.label}: ${labels.join(", ")}. Edit`}
        searchPlaceholder={`Search ${column.label.toLowerCase()}`}
        clearLabel={`Clear ${column.label.toLowerCase()}`}
        buttonClassName="flex h-8 max-w-[220px] items-center gap-1 border-l border-os-container px-2 font-semibold text-foreground transition-colors hover:bg-os-hover focus-visible:bg-os-hover focus-visible:outline-none"
        renderTrigger={({ open }) => (
          <>
            <span className="truncate">{summary}</span>
            <ChevronDown
              className={cn("h-3.5 w-3.5 shrink-0 text-os-muted transition-transform", open && "rotate-180")}
              aria-hidden
            />
          </>
        )}
      />
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove ${column.label} filter`}
        className="flex h-full w-7 items-center justify-center border-l border-os-container text-os-muted transition-colors hover:bg-os-hover hover:text-foreground focus-visible:bg-os-hover focus-visible:outline-none"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FilterValuePicker({
  column,
  selected,
  options,
  countFor,
  onToggle,
  onClear,
  onBack,
}: {
  column: FilterColumn;
  selected: string[];
  options: string[];
  countFor: (key: string, option: string) => number;
  onToggle: (value: string) => void;
  onClear: () => void;
  onBack: () => void;
}) {
  return (
    <div className={cn(MENU_CLASS, "w-64")}>
      <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <span className="text-xs font-semibold text-os-muted">
          <button type="button" onClick={onBack} className="mr-1 text-os-grey hover:text-foreground">
            Filters /
          </button>
          {column.label}
        </span>
        {selected.length > 0 && (
          <span className="text-xs font-semibold text-os-accent">{selected.length} selected</span>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto px-1.5 pb-1.5">
        <MultiSelectList
          values={selected}
          options={valueOptions(column, options, countFor)}
          onToggle={onToggle}
          onClear={onClear}
          clearLabel={`Clear ${column.label.toLowerCase()}`}
          ariaLabel={column.label}
          searchPlaceholder={`Search ${column.label.toLowerCase()}`}
          autoFocus
        />
      </div>
    </div>
  );
}
