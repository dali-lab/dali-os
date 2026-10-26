// Shared Tailwind for the floating primitives so Select / Menu / ContextMenu read
// identically. Kept in one place so a look change lands everywhere at once.

/* ── dali.os dress ───────────────────────────────────────────────────────
 * Sidebar-era metrics: 8px-cornered triggers and filters, a 12px card panel,
 * roomier rows.
 * The compact trigger keeps today's text-xs/px-3 metrics on purpose — Select
 * is used inside table cells and dense forms, and inflating the default would
 * reflow every one of them. Page toolbars ask for the roomy filter explicitly
 * via OS_FILTER_PILL_CLASS. */

/** The raised-surface dress itself, without the panel's padding or z-index —
 *  hand-rolled popovers (the calendar's event and time-entry cards) wear the
 *  same one, so it lives here rather than being re-typed per page. */
export const OS_SURFACE_CLASS =
  "rounded-os-card border border-os-container bg-os-card shadow-[0_16px_40px_var(--color-os-shadow)]";

export const OS_PANEL_CLASS = `z-[60] overflow-y-auto ${OS_SURFACE_CLASS} p-1.5 focus:outline-none`;

// No text colour: cn() has no tailwind-merge, so a row's own colour
// (destructive, muted) would race a base text-foreground on stylesheet order.
export const OS_MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 disabled:hover:bg-transparent";

export const OS_SELECT_TRIGGER_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60 disabled:hover:bg-transparent";

/**
 * The roomy toolbar filter pill — the Term / Domain / Website controls that sit
 * in a page's filter row. One definition so those rows can't drift apart; pass
 * a width alongside it (`cn(filterPillClass(os), "w-full sm:w-40")`).
 */
export const OS_FILTER_PILL_CLASS =
  "inline-flex h-9 items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 text-sm text-foreground transition-colors hover:bg-muted/40";

// The `os` arg is vestigial (the dali.os pill is the only one now); kept
// optional so the remaining call sites compile until they drop it.
export function filterPillClass(_os?: boolean) {
  return OS_FILTER_PILL_CLASS;
}
