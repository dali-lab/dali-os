import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown, ChevronRight, ListFilter, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Popover } from "~/components/ui/floating";
import { isInFloatingLayer } from "~/components/ui/floating/outside";
import { OS_PANEL_CLASS, OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import { cn } from "~/lib/cn";

export type FilterBarColumn = {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** Muted text before the label in the column menu, e.g. a question number. */
  prefix?: string;
  /** Values (or one, for a free-form filter) applied to this column; 0 when unfiltered. */
  count: number;
  /** What the pill shows after the label. */
  summary: string;
  /** Full text for the pill's accessible name when `summary` abbreviates. */
  detail?: string;
  /** Header text beside the picker; defaults to "N selected". */
  status?: string;
  /** Removes this column's filter. */
  onClear: () => void;
  /** The picker body, shown in the menu's second stage and in the pill's popover. */
  renderPicker: (opts: { autoFocus: boolean }) => ReactNode;
};

function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !isInFloatingLayer(e.target)) {
        onClose();
      }
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

export function FilterBar({
  columns,
  onClearAll,
  count,
}: {
  columns: FilterBarColumn[];
  onClearAll: () => void;
  /** Right-aligned line, e.g. "12 of 49 responses". */
  count: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [stageKey, setStageKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setStageKey(null);
  }, []);
  useDismiss(ref, open, close);

  const stage = columns.find((c) => c.key === stageKey) ?? null;
  const active = columns.filter((c) => c.count > 0);
  const activeCount = active.reduce((n, c) => n + c.count, 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div ref={ref} className="relative">
        <Button
          size="sm"
          variant="secondary"
          disabled={columns.length === 0}
          title={columns.length === 0 ? "No columns to filter yet" : undefined}
          onClick={() => (open ? close() : setOpen(true))}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn("h-8", open && "border-os-container-hi bg-os-hover")}
        >
          <ListFilter className="h-4 w-4" aria-hidden />
          Filter
          {activeCount > 0 && (
            <span className="-mr-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-os-accent px-1.5 text-xs font-bold text-os-bg">
              {activeCount}
            </span>
          )}
        </Button>
        {open && !stage && (
          <div role="menu" className={cn(MENU_CLASS, "w-56 p-1.5")}>
            <p className="px-2.5 pb-1 pt-1 text-xs font-semibold text-os-muted">Filter by</p>
            {columns.map((col) => (
              <button
                key={col.key}
                type="button"
                role="menuitem"
                onClick={() => setStageKey(col.key)}
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-os-hover focus-visible:bg-os-hover focus-visible:outline-none"
              >
                {col.icon && <col.icon className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />}
                {col.prefix && <span className="shrink-0 text-xs text-os-muted">{col.prefix}</span>}
                <span className="truncate">{col.label}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {col.count > 0 && <span className="text-xs font-semibold text-os-accent">{col.count}</span>}
                  <ChevronRight className="h-3.5 w-3.5 text-os-muted" aria-hidden />
                </span>
              </button>
            ))}
          </div>
        )}
        {open && stage && (
          <div className={cn(MENU_CLASS, "w-64")}>
            <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
              <span className="text-xs font-semibold text-os-muted">
                <button
                  type="button"
                  onClick={() => setStageKey(null)}
                  className="mr-1 text-os-grey hover:text-foreground"
                >
                  Filters /
                </button>
                {stage.label}
              </span>
              {stage.count > 0 && (
                <span className="text-xs font-semibold text-os-accent">
                  {stage.status ?? `${stage.count} selected`}
                </span>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto px-1.5 pb-1.5">
              {stage.renderPicker({ autoFocus: true })}
            </div>
          </div>
        )}
      </div>

      {active.length > 0 && <span className="mx-0.5 h-5 w-px bg-os-container" aria-hidden />}

      {active.map((col) => (
        <FilterPill key={col.key} column={col} />
      ))}
      {active.length > 0 && (
        <Button variant="ghost" size="sm" className="h-8" onClick={onClearAll}>
          Clear all
        </Button>
      )}

      <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
        {count}
      </p>
    </div>
  );
}

function FilterPill({ column }: { column: FilterBarColumn }) {
  return (
    <div className="flex h-8 items-center overflow-hidden rounded-lg border border-os-container bg-os-card text-sm transition-colors">
      <span className="flex h-full items-center gap-1.5 pl-2.5 pr-2 text-os-grey">
        {column.icon && <column.icon className="h-3.5 w-3.5" aria-hidden />}
        {column.label}
      </span>
      <Popover
        panelClassName={cn(OS_PANEL_CLASS, "flex w-64 max-w-[22rem] flex-col pt-0")}
        trigger={(open) => (
          <button
            type="button"
            aria-label={`${column.label}: ${column.detail ?? column.summary}. Edit`}
            className="flex h-8 max-w-[220px] items-center gap-1 border-l border-os-container px-2 font-semibold text-foreground transition-colors hover:bg-os-hover focus-visible:bg-os-hover focus-visible:outline-none"
          >
            <span className="truncate">{column.summary}</span>
            <ChevronDown
              className={cn("h-3.5 w-3.5 shrink-0 text-os-muted transition-transform", open && "rotate-180")}
              aria-hidden
            />
          </button>
        )}
      >
        {column.renderPicker({ autoFocus: false })}
      </Popover>
      <button
        type="button"
        onClick={column.onClear}
        aria-label={`Remove ${column.label} filter`}
        className="flex h-full w-7 items-center justify-center border-l border-os-container text-os-muted transition-colors hover:bg-os-hover hover:text-foreground focus-visible:bg-os-hover focus-visible:outline-none"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
