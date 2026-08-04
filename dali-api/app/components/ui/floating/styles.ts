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
