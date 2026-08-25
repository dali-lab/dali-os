import type { ReactNode } from "react";
import { cn } from "~/lib/cn";
import { OS_SURFACE_CLASS, filterPillClass } from "./floating/styles";

/* The "Customize" panel: one toolbar pill that folds a page's slices into a
 * popover, plus the pieces its body is built from. A row of selects grows with
 * the data until the toolbar is nothing but controls; behind one pill the page
 * keeps its width, and the badge says how many slices are on so a filtered view
 * is never silently filtered.
 *
 * Pair with <Popover>. The body is built from in-flow pills rather than
 * <Select>s on purpose: a portaled listbox counts as an outside press against
 * the panel, so choosing an option would dismiss the panel it was chosen in.
 */

/** The trigger pill. `active` when at least one slice is on. */
export function customizeButtonClass(os: boolean, active: boolean) {
  return cn(
    filterPillClass(os),
    "gap-2",
    !os && "px-3 py-1.5 text-xs",
    active && (os ? "border-os-accent text-os-accent" : "border-accent-coral"),
  );
}

/** Pass to <Popover panelClassName>. */
export function filterPanelClass(os: boolean) {
  return cn(
    "z-[60] w-72 overflow-y-auto p-3 focus:outline-none",
    os ? OS_SURFACE_CLASS : "rounded-md border border-border bg-card shadow-brand-2",
  );
}

export function FilterCountBadge({ os, count }: { os: boolean; count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        os ? "bg-os-accent text-os-bg" : "bg-accent-coral text-navy-deep",
      )}
    >
      {count}
    </span>
  );
}

export function FilterResetButton({
  os,
  onClick,
}: {
  os: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-xs underline-offset-2 hover:underline",
        os ? "text-os-accent" : "text-accent-coral",
      )}
    >
      Reset
    </button>
  );
}

export function FilterSectionLabel({
  os,
  children,
}: {
  os: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wide",
        os ? "text-os-muted" : "text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function FilterGroup({
  label,
  os,
  children,
}: {
  label: string;
  os: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={cn("text-xs", os ? "text-os-grey" : "text-muted-foreground")}>
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function FilterPill({
  os,
  selected,
  onClick,
  children,
}: {
  os: boolean;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "max-w-full truncate rounded-full border px-2.5 py-1 text-xs transition-colors",
        selected
          ? os
            ? "border-os-accent bg-os-accent/15 text-os-accent"
            : "border-accent-coral bg-accent-coral/10 text-accent-coral"
          : os
            ? "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground"
            : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
