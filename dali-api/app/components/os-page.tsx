import type { ReactNode } from "react";
import { SegmentedTabButtons } from "./AreaPillNav";

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

/* The same row, with a field where the value was. When inside a
   grid grid-cols-[max-content_1fr] container, col-span-2 + subgrid makes every
   row share the same column tracks — the label column auto-sizes to the widest
   label in the card, so all inputs start at the same X. */
export function DetailEditRow({
  icon,
  label,
  infoTip,
  children,
}: {
  icon: ReactNode;
  label: string;
  infoTip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid items-center gap-x-6 border-b border-os-container py-3 last:border-0">
      <span className="flex shrink-0 items-center gap-2.5 text-sm text-os-grey whitespace-nowrap">
        {icon}
        {label}
        {infoTip}
      </span>
      <div className="min-w-0">{children}</div>
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

// The hub page's tab strip is the same segmented pill the rest of the os uses,
// so a project page, a member profile and the Core hub switch sections with
// one control.

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
  /** Pinned to the far right of the row — a settings gear, an action. */
  trailing?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <SegmentedTabButtons
        label={ariaLabel}
        items={tabs.map((t) => ({
          label: t.label,
          active: active === t.key,
          onClick: () => onSelect(t.key),
        }))}
      />
      {trailing && <div className="ml-auto">{trailing}</div>}
    </div>
  );
}
