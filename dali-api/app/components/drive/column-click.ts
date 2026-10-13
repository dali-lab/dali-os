export type ColumnClickIntent = "toggle" | "range" | "select" | "ignore";

/**
 * What a click on a Miller-column row means. Like Finder, a click only ever
 * selects; opening a document is a double-click or Enter.
 */
export function columnClickIntent(input: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** The selection anchor sits in the clicked row's own column. */
  anchorInColumn: boolean;
  /** This click is the tail of a drag. */
  suppressed: boolean;
}): ColumnClickIntent {
  if (input.suppressed) return "ignore";
  if (input.metaKey || input.ctrlKey) return "toggle";
  if (input.shiftKey && input.anchorInColumn) return "range";
  return "select";
}
