/**
 * Splits a trail into the items kept at each end and the middle run that folds
 * behind a "⋯" menu. Only folds when that hides two or more items: a menu in
 * place of a single crumb takes the same room and costs a click.
 */
export function collapseMiddle<T>(
  items: T[],
  keepStart: number,
  keepEnd: number,
): { head: T[]; hidden: T[]; tail: T[] } {
  if (items.length - keepStart - keepEnd < 2) return { head: items, hidden: [], tail: [] }
  return {
    head: items.slice(0, keepStart),
    hidden: items.slice(keepStart, items.length - keepEnd),
    tail: items.slice(items.length - keepEnd),
  }
}
