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
import { Check, ChevronDown, ChevronRight, ListFilter, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { SearchInput } from "~/components/ui/SearchInput";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import { cn } from "~/lib/cn";
import {
  applicableFilters,
  cellValues,
  clearFilterColumn,
  columnResponses,
  filterValues,
  matchesFilters,
  toggleFilterValue,
  type ColumnFilter,
  type FilterCells,
} from "../lib/submission-filters";

export type FilterColumn = { key: string; label: string; icon?: LucideIcon };

// Filter state for a board plus the row predicate to hand useFilteredList
// (put `active` in its `deps`).
export function useColumnFilters(columns: { key: string }[], initial: ColumnFilter[] = []) {
  const [filters, setFilters] = useState<ColumnFilter[]>(initial);
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
  const [openPill, setOpenPill] = useState<string | null>(null);
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

  if (columns.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div ref={addRef} className="relative">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => (addOpen ? closeAdd() : (setOpenPill(null), setAddOpen(true)))}
          aria-haspopup="menu"
          aria-expanded={addOpen}
          className={cn("h-8", addOpen && "border-os-container-hi bg-os-hover")}
        >
          <ListFilter className="h-4 w-4" aria-hidden />
          Filter
          {activeCount > 0 && (
            <span className="-mr-1 flex h-5 min-w-5 items-center justify-center rounded-md bg-os-accent px-1.5 text-xs font-bold text-os-bg">
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
            options={columnResponses(rows, addStage.key)}
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
          options={columnResponses(rows, col.key)}
          open={openPill === col.key}
          onOpenChange={(open) => {
            if (open) closeAdd();
            setOpenPill(open ? col.key : null);
          }}
          countFor={countFor}
          onToggle={(v) => onChange(toggleFilterValue(filters, col.key, v))}
          onClear={() => {
            onChange(clearFilterColumn(filters, col.key));
            setOpenPill(null);
          }}
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

function FilterPill({
  column,
  selected,
  options,
  open,
  onOpenChange,
  countFor,
  onToggle,
  onClear,
}: {
  column: FilterColumn;
  selected: string[];
  options: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  countFor: (key: string, option: string) => number;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => onOpenChange(false));
  const summary =
    selected.length <= 2 ? selected.join(", ") : `${selected[0]} +${selected.length - 1}`;

  return (
    <div ref={ref} className="relative">
      <div
        className={cn(
          "flex h-8 items-center overflow-hidden rounded-lg border bg-os-card text-sm transition-colors",
          open ? "border-os-container-hi" : "border-os-container",
        )}
      >
        <span className="flex h-full items-center gap-1.5 pl-2.5 pr-2 text-os-grey">
          {column.icon && <column.icon className="h-3.5 w-3.5" aria-hidden />}
          {column.label}
        </span>
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${column.label}: ${selected.join(", ")}. Edit`}
          className="flex h-full max-w-[220px] items-center gap-1 border-l border-os-container px-2 font-semibold text-foreground transition-colors hover:bg-os-hover focus-visible:bg-os-hover focus-visible:outline-none"
        >
          <span className="truncate">{summary}</span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 text-os-muted transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label={`Remove ${column.label} filter`}
          className="flex h-full w-7 items-center justify-center border-l border-os-container text-os-muted transition-colors hover:bg-os-hover hover:text-foreground focus-visible:bg-os-hover focus-visible:outline-none"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <FilterValuePicker
          column={column}
          selected={selected}
          options={options}
          countFor={countFor}
          onToggle={onToggle}
          onClear={onClear}
        />
      )}
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
  onBack?: () => void;
}) {
  const [search, setSearch] = useState("");
  const shown = options.filter((o) =>
    o.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className={cn(MENU_CLASS, "w-64")}>
      <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <span className="text-xs font-semibold text-os-muted">
          {onBack && (
            <button type="button" onClick={onBack} className="mr-1 text-os-grey hover:text-foreground">
              Filters /
            </button>
          )}
          {column.label}
        </span>
        {selected.length > 0 && (
          <span className="text-xs font-semibold text-os-accent">{selected.length} selected</span>
        )}
      </div>

      <div className="px-1.5 pb-1">
        <SearchInput
          size="sm"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${column.label.toLowerCase()}`}
          aria-label={`Search ${column.label.toLowerCase()}`}
        />
      </div>

      <div
        role="listbox"
        aria-multiselectable
        aria-label={column.label}
        className="max-h-60 overflow-y-auto px-1.5 pb-1.5"
      >
        {shown.length === 0 && <p className="px-2.5 py-3 text-sm text-os-muted">No matches</p>}
        {shown.map((opt) => {
          const checked = selected.includes(opt);
          const count = countFor(column.key, opt);
          return (
            <button
              key={opt}
              type="button"
              role="option"
              aria-selected={checked}
              onClick={() => onToggle(opt)}
              className={cn(
                "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors hover:bg-os-hover focus-visible:bg-os-hover focus-visible:outline-none",
                count === 0 && !checked ? "text-os-muted" : "text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                  checked ? "border-os-accent bg-os-accent text-os-bg" : "border-os-container-hi",
                )}
                aria-hidden
              >
                {checked && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className={cn("truncate", checked && "font-semibold")}>{opt}</span>
              <span className="ml-auto text-xs tabular-nums text-os-muted">{count}</span>
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="border-t border-os-container px-1.5 py-1.5">
          <button
            type="button"
            onClick={onClear}
            className="flex h-8 w-full items-center justify-center rounded-lg text-sm font-semibold text-os-grey transition-colors hover:bg-os-hover hover:text-foreground"
          >
            Clear {column.label.toLowerCase()}
          </button>
        </div>
      )}
    </div>
  );
}
