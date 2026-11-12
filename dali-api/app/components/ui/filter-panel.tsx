import type { ReactNode } from "react";
import { cn } from "~/lib/cn";
import { Toggle } from "./Toggle";
import { OS_SURFACE_CLASS, filterPillClass } from "./floating/styles";
import { Z } from "~/components/ui/z";

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
export function customizeButtonClass(active: boolean) {
  return cn(filterPillClass(), "gap-2", active && "border-os-accent text-os-accent");
}

/** Pass to <Popover panelClassName>. */
export function filterPanelClass() {
  return cn(
    `${Z.popover} w-72 overflow-y-auto p-3 focus:outline-none`,
    OS_SURFACE_CLASS,
  );
}

export function FilterCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="rounded-[6px] bg-os-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-os-bg">
      {count}
    </span>
  );
}

export function FilterResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-os-accent underline-offset-2 hover:underline"
    >
      Reset
    </button>
  );
}

export function FilterSectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-semibold text-os-muted">{children}</span>;
}

/** Every row in a panel body labels itself the same way, so the panel reads
 *  down one label column instead of a different label style per control. */
function FilterLabel({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-os-grey">
      {children}
      {hint}
    </span>
  );
}

/** A labelled row whose control is arbitrary (a combobox, a stack of rows).
 *  `hint` sits beside the label — an <InfoTip>, typically. */
export function FilterField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel hint={hint}>{label}</FilterLabel>
      {children}
    </div>
  );
}

/** A labelled row of pills — the panel's default control. */
export function FilterGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <FilterField label={label} hint={hint}>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </FilterField>
  );
}

/** A switch row. The label sits left of the switch, in the same type as every
 *  other row's label, so a toggle doesn't break the panel's label column the
 *  way a bare <Toggle> (label to the right of the switch, a size up) does. */
export function FilterToggleRow({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Toggle
      label={label}
      className="w-full flex-row-reverse justify-between"
      labelClassName="text-xs text-os-grey"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

// "sm" is the dense in-panel chip (filter panels, dropdowns, table toolbars);
// "md" matches <SearchInput size="md"> line for line (36px), for the chips
// that sit beside one as a single filter bar.
const PILL_SIZES = {
  sm: "px-2.5 py-1 text-xs",
  md: "h-9 px-4 text-sm",
} as const;

export function filterPillStateClass(
  selected: boolean,
  size: keyof typeof PILL_SIZES,
  variant: "default" | "filled",
) {
  if (variant === "filled") {
    return selected
      ? "border-os-accent bg-os-accent font-medium text-background"
      : cn(
          "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground",
          size === "md" && "bg-card",
        );
  }
  return selected
    ? "border-os-accent bg-os-accent/15 text-os-accent"
    : "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground";
}

/** `filled` is the solid accent selection the education catalog uses beside its search field. */
export function FilterPill({
  selected,
  onClick,
  children,
  size = "sm",
  variant = "default",
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  size?: keyof typeof PILL_SIZES;
  variant?: "default" | "filled";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "max-w-full truncate rounded-lg border transition-colors",
        size === "md" && "inline-flex items-center",
        PILL_SIZES[size],
        filterPillStateClass(selected, size, variant),
      )}
    >
      {children}
    </button>
  );
}
