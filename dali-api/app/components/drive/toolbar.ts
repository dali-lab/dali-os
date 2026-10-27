import { cn } from "~/lib/cn";

// Drive's toolbar controls speak the sidebar's control language (see
// app/components/shell/Rail.tsx): 32px rounded-lg rows, quiet wash hovers,
// a press scale and the accent focus ring — not the big add pill.
const BASE =
  "flex h-8 shrink-0 items-center rounded-lg outline-none transition-[background-color,color,transform] duration-150 ease-out active:scale-95 focus-visible:ring-2 focus-visible:ring-os-accent/60";

/** Labeled toolbar button (New). */
export const DRIVE_TOOLBAR_BTN = cn(
  BASE,
  "gap-1.5 px-3 text-sm font-medium bg-os-hover text-foreground hover:bg-os-hover-strong",
);

/** Icon-only toolbar button (the ⋯ overflow). */
export const DRIVE_TOOLBAR_ICON_BTN = cn(
  BASE,
  "w-8 justify-center text-os-grey hover:bg-os-hover hover:text-foreground",
);
