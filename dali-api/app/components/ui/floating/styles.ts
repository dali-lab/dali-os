// Shared Tailwind for the floating primitives so Select / Menu / ContextMenu read
// identically (the app's bespoke-popover look: card surface, hairline border,
// brand shadow). Kept in one place so a look change lands everywhere at once.

export const PANEL_CLASS =
  "z-[60] overflow-y-auto rounded-md border border-border bg-card p-1 shadow-brand-2 focus:outline-none";

// Row inside a Menu / ContextMenu (single line, icon + label).
export const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground transition-colors disabled:opacity-50 disabled:hover:bg-transparent";

// The default Select trigger (mirrors the old SelectMenu default so call sites
// that relied on it are unchanged).
export const SELECT_TRIGGER_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60 disabled:hover:bg-transparent";

/* ── dali.os variants (behind the `os-redesign` flag) ────────────────────
 * The design has no square-cornered controls, so the floating primitives get
 * an os dress too: fully-rounded triggers, a 12px card panel and roomier rows.
 * The compact trigger keeps today's text-xs/px-3 metrics on purpose — Select
 * is used inside table cells and dense forms, and inflating the default would
 * reflow every one of them. Page toolbars ask for the roomy pill explicitly
 * via OS_FILTER_PILL_CLASS. */

/** The raised-surface dress itself, without the panel's padding or z-index —
 *  hand-rolled popovers (the calendar's event and time-entry cards) wear the
 *  same one, so it lives here rather than being re-typed per page. */
export const OS_SURFACE_CLASS =
  "rounded-os-item border border-os-container bg-os-card shadow-[0_16px_40px_var(--color-os-shadow)]";

export const OS_PANEL_CLASS = `z-[60] overflow-y-auto ${OS_SURFACE_CLASS} p-1.5 focus:outline-none`;

export const OS_MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors disabled:opacity-50 disabled:hover:bg-transparent";

export const OS_SELECT_TRIGGER_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60 disabled:hover:bg-transparent";

/**
 * The roomy toolbar filter pill — the Term / Domain / Website controls that sit
 * in a page's filter row. One definition so those rows can't drift apart; pass
 * a width alongside it (`cn(filterPillClass(os), "w-full sm:w-40")`).
 */
export const OS_FILTER_PILL_CLASS =
  "inline-flex items-center justify-between gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-muted/40";

export const FILTER_PILL_CLASS =
  "inline-flex items-center justify-between gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/40";

export function filterPillClass(os: boolean) {
  return os ? OS_FILTER_PILL_CLASS : FILTER_PILL_CLASS;
}
