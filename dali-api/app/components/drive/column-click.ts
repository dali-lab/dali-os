export type ClickIntent = "select" | "open" | "toggle" | "range" | "ignore";

/**
 * What a click on a row, tile or card means, in every view. A plain click
 * selects the item alone, as in Finder; the modifier keys toggle or extend the
 * selection. A tap opens, since touch has no double-click to open with.
 */
export function clickIntent(input: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** The selection anchor sits in the same pool of rows as the clicked one (its own column, or the listing). */
  anchorInPool: boolean;
  /** This click is the tail of a drag. */
  suppressed: boolean;
  /** The click came from a touch pointer. */
  touch?: boolean;
}): ClickIntent {
  if (input.suppressed) return "ignore";
  if (input.metaKey || input.ctrlKey) return "toggle";
  if (input.shiftKey && input.anchorInPool) return "range";
  return input.touch ? "open" : "select";
}
