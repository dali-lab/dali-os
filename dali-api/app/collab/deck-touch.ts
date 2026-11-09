import type * as Y from "yjs";
import { slidesMap } from "~/components/slides/deck/model";

export interface DeckTouch {
  slideIds: string[];
  /** `slideId/elementId`: slot boxes share their slot name as id on every slide. */
  elementKeys: string[];
  /** The slide whose elements changed last, else the last slide changed. */
  slideId: string | null;
}

export const deckTouchKey = (slideId: string, elementId: string): string => `${slideId}/${elementId}`;

type AnyType = Y.AbstractType<any>;

function pathTo(type: AnyType, root: AnyType): string[] | null {
  const path: string[] = [];
  let at: AnyType | null = type;
  while (at && at !== root) {
    const item: Y.Item | null = at._item;
    if (!item || typeof item.parentSub !== "string") {
      if (!item) return null;
      at = item.parent as AnyType;
      continue;
    }
    path.unshift(item.parentSub);
    at = item.parent as AnyType;
  }
  return at === root ? path : null;
}

/** Runs `mutate` and reports the slides and elements its transactions changed, in the order they were first changed. */
export function collectDeckTouch(doc: Y.Doc, mutate: () => void): DeckTouch {
  const root = slidesMap(doc) as unknown as AnyType;
  const slides = new Set<string>();
  const elements = new Set<string>();
  let focus: string | null = null;
  const onTransaction = (txn: Y.Transaction) => {
    txn.changed.forEach((keys, type) => {
      const path = pathTo(type, root);
      if (!path) return;
      const named = [...keys].filter((k): k is string => typeof k === "string");
      if (path.length === 0) {
        for (const id of named) slides.add(id);
        return;
      }
      slides.add(path[0]);
      if (path[1] !== "elements" && path[1] !== "text") return;
      const ids = path.length >= 3 ? [path[2]] : named;
      for (const id of ids) elements.add(deckTouchKey(path[0], id));
      if (ids.length > 0) focus = path[0];
    });
  };
  doc.on("afterTransaction", onTransaction);
  try {
    mutate();
  } finally {
    doc.off("afterTransaction", onTransaction);
  }
  return { slideIds: [...slides], elementKeys: [...elements], slideId: focus ?? [...slides].at(-1) ?? null };
}
