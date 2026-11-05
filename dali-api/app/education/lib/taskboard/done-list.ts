export const DONE_PREVIEW = 5;

export type DoneItem = { id: string; completedAt: string | null };

function newestFirst<T extends DoneItem>(a: T, b: T): number {
  return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
}

export type DoneView<T> = {
  rows: T[];
  total: number;
  hidden: number;
  canToggle: boolean;
};

export function doneView<T extends DoneItem>(tasks: T[], showAll: boolean): DoneView<T> {
  const sorted = [...tasks].sort(newestFirst);
  const rows = showAll ? sorted : sorted.slice(0, DONE_PREVIEW);
  return {
    rows,
    total: sorted.length,
    hidden: sorted.length - rows.length,
    canToggle: sorted.length > DONE_PREVIEW,
  };
}

export function doneToggleLabel(view: Pick<DoneView<unknown>, "total" | "hidden">, showAll: boolean): string {
  return showAll ? `Show only the latest ${DONE_PREVIEW}` : `Show all ${view.total} (${view.hidden} more)`;
}

export function railCount(n: number): { label: string; small: boolean } {
  return n > 99 ? { label: "99+", small: true } : { label: String(n), small: false };
}
