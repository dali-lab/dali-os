export type ClickIntent = "open" | "toggle" | "range" | "ignore";

/**
 * What a click on a row, tile or card means, in every view. A plain click
 * opens the item (a folder is entered); the modifier keys select without
 * opening.
 */
export function clickIntent(input: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** The selection anchor sits in the same pool of rows as the clicked one (its own column, or the listing). */
  anchorInPool: boolean;
  /** This click is the tail of a drag. */
  suppressed: boolean;
}): ClickIntent {
  if (input.suppressed) return "ignore";
  if (input.metaKey || input.ctrlKey) return "toggle";
  if (input.shiftKey && input.anchorInPool) return "range";
  return "open";
}
