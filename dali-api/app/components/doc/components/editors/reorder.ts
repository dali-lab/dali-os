import type { DragEvent, KeyboardEvent, MutableRefObject } from "react";

export const ITEM_DRAG_MIME = "application/x-dali-cmp-index";
const GRIP = "[data-reorder-grip]";

export function startItemDrag(e: DragEvent, i: number) {
  e.dataTransfer.setData(ITEM_DRAG_MIME, String(i));
  e.dataTransfer.effectAllowed = "move";
}

export function reorderDirection(e: KeyboardEvent<HTMLElement>, keys: readonly [string, string]): -1 | 0 | 1 {
  if (!e.altKey || !keys.includes(e.key)) return 0;
  const target = e.target as Element;
  if (!e.currentTarget.contains(target)) return 0;
  if (target !== e.currentTarget && !target.closest(GRIP)) return 0;
  return e.key === keys[0] ? -1 : 1;
}

export function focusGrip(container: Element | null, index: number) {
  requestAnimationFrame(() => container?.querySelectorAll<HTMLElement>(GRIP)[index]?.focus());
}

export type FormCommit<F> = { kind: "skip" } | { kind: "blocked" } | { kind: "apply"; fields: F };
export type FormCommitRef<F> = MutableRefObject<(() => FormCommit<F>) | null>;

export function applyForm<T extends object, F extends object>(items: T[], form: number | "new" | null, fields: F): T[] {
  if (form === "new") return [...items, fields as unknown as T];
  return items.map((x, j) => (j === form ? { ...x, ...fields } : x));
}
