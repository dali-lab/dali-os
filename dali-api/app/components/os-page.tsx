import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

// The parts a dali.os hub page is built from — the hero's labelled clusters,
// the tab strip under it, and the hairlined facts card its sections state their
// details in. Shared by the project detail page and the member profile so the
// two read as one page shape rather than two that drift.

// The dali.os "facts list": a card whose rows are an icon/label on the left and
// the value on the right, hairlined between. The project page's Project details
// and the member profile's Personal both wear it, in read and edit mode, so the
// two pages state a fact the same way.

/** The card the rows sit in. Rows supply their own hairline. */
export const OS_DETAIL_CARD = "rounded-os-card bg-os-card px-5";

/** Sizing for the glyph a row's label carries. */
export const OS_DETAIL_ICON = "h-[17px] w-[17px] text-os-grey";

// One label/value row: a muted label with its glyph on the left, the value
// right-aligned.
export function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-os-container py-3 last:border-0">
      <span className="flex items-center gap-2.5 text-sm text-os-grey">
        {icon}
        {label}
      </span>
      <div className="min-w-0 text-right text-sm text-foreground">{children}</div>
    </div>
  );
}

/* The same row, with a field where the value was. Stacks on a narrow screen so
   an input never has to share a line with its own label. */
export function DetailEditRow({
  icon,
  label,
  hint,
  children,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-os-container py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2.5 text-sm text-os-grey">
          {icon}
          {label}
        </span>
        {hint && <span className="pl-[27px] text-xs text-os-muted">{hint}</span>}
      </span>
      <div className="w-full sm:max-w-[24rem]">{children}</div>
    </div>
  );
}

/** The label a hero cluster wears (TERMS, ROLES) with its contents beside it. */
export function HeroClusterLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs font-semibold tracking-widest text-os-grey uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

// The dali.os page tab strip: the design marks the open tab with a filled,
// top-rounded plate that meets the rule below it, not an underline. Shared by
// the project detail page and the member profile so a hub page's tabs are one
// shape, not two that drift.

export function OsTabBar<T extends string>({
  tabs,
  active,
  onSelect,
  trailing,
  ariaLabel,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onSelect: (key: T) => void;
  /** Pinned to the far right of the strip — a settings gear, an action. */
  trailing?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex items-center gap-2 border-b border-border"
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onSelect(t.key)}
          className={cn(
            "rounded-t-[10px] px-5 py-2.5 text-base font-medium transition-colors",
            active === t.key
              ? "bg-os-container text-foreground"
              : "text-os-grey hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
      {trailing}
    </div>
  );
}
