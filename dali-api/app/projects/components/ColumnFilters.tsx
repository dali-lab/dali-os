// Column filter builder for the form-bound submission boards. Each row is
// column + operator + value; rows AND together. Presentational: the parent owns
// the filter list and applies it (see submission-filters.ts).

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { SearchInput } from "~/components/ui/SearchInput";
import { Select } from "~/components/ui/floating";
import {
  FILTER_OPERATORS,
  applicableFilters,
  columnResponses,
  matchesFilters,
  operatorNeedsValue,
  operatorPicksResponse,
  type ColumnFilter,
  type FilterOperator,
} from "../lib/submission-filters";

// Filter state for a board plus the row predicate to hand useFilteredList
// (put `active` in its `deps`).
export function useColumnFilters(columns: { key: string }[]) {
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  const active = useMemo(
    () => applicableFilters(filters, columns.map((c) => c.key)),
    [filters, columns],
  );
  const predicate = (row: { cells: Record<string, string> }) => matchesFilters(row.cells, active);
  return { filters, setFilters, active, predicate };
}

const CONTROL_CLASS =
  "inline-flex w-full items-center justify-between gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/40";

export function ColumnFilters({
  columns,
  rows,
  filters,
  onChange,
}: {
  columns: { key: string; label: string }[];
  // Unfiltered rows: the value dropdown offers every response in the column.
  rows: readonly { cells: Record<string, string> }[];
  filters: ColumnFilter[];
  onChange: (next: ColumnFilter[]) => void;
}) {
  if (columns.length === 0) return null;

  const update = (id: string, patch: Partial<ColumnFilter>) =>
    onChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const add = () =>
    onChange([
      ...filters,
      { id: crypto.randomUUID(), columnKey: columns[0].key, operator: "is", value: "" },
    ]);

  const columnOptions = columns.map((c) => ({ value: c.key, label: c.label }));

  return (
    <div className="flex flex-col gap-2">
      {filters.map((f) => (
        <div key={f.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="sm:w-56">
            <Select
              value={f.columnKey}
              options={columnOptions}
              ariaLabel="Column"
              buttonClassName={CONTROL_CLASS}
              onChange={(columnKey) => update(f.id, { columnKey, value: "" })}
            />
          </div>
          <div className="sm:w-44">
            <Select<FilterOperator>
              value={f.operator}
              options={[...FILTER_OPERATORS]}
              ariaLabel="Condition"
              buttonClassName={CONTROL_CLASS}
              onChange={(operator) =>
                update(f.id, {
                  operator,
                  // A picked response isn't a sensible search term and vice
                  // versa, so the value only survives within the same kind.
                  value:
                    operatorNeedsValue(operator) &&
                    operatorPicksResponse(operator) === operatorPicksResponse(f.operator)
                      ? f.value
                      : "",
                })
              }
            />
          </div>
          {operatorNeedsValue(f.operator) && (
            <div className="min-w-0 sm:w-64">
              {operatorPicksResponse(f.operator) ? (
                <Select
                  value={f.value}
                  options={columnResponses(rows, f.columnKey).map((v) => ({ value: v, label: v }))}
                  ariaLabel="Response"
                  placeholder="Pick a response"
                  buttonClassName={CONTROL_CLASS}
                  onChange={(value) => update(f.id, { value })}
                />
              ) : (
                <SearchInput
                  value={f.value}
                  onChange={(e) => update(f.id, { value: e.target.value })}
                  placeholder="Text"
                  aria-label="Text"
                  size="sm"
                />
              )}
            </div>
          )}
          <IconButton
            label="Remove filter"
            icon={X}
            onClick={() => onChange(filters.filter((x) => x.id !== f.id))}
          />
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
          Add filter
        </Button>
        {filters.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Clear all
          </Button>
        )}
      </div>
    </div>
  );
}
