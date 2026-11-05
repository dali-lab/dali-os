export interface ThumbSelection {
  selected: string[];
  anchor: string | null;
}

/** Click, shift-click (a range from the anchor) and meta-click (toggle) on thumbnails. `order` is the deck's slide order. */
export function nextThumbSelection(order: string[], state: ThumbSelection, id: string, mods: { shift: boolean; meta: boolean }): ThumbSelection {
  if (mods.shift && state.anchor && order.includes(state.anchor)) {
    const a = order.indexOf(state.anchor);
    const b = order.indexOf(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return { selected: order.slice(lo, hi + 1), anchor: state.anchor };
  }
  if (mods.meta) {
    const has = state.selected.includes(id);
    const selected = has ? state.selected.filter((s) => s !== id) : [...state.selected, id];
    return { selected: order.filter((s) => selected.includes(s)), anchor: id };
  }
  return { selected: [id], anchor: id };
}

/** The slides a drag or menu acts on: the whole selection if the grabbed one is in it, else just the grabbed one. */
export function actingSet(order: string[], selected: string[], grabbed: string): string[] {
  return selected.includes(grabbed) ? order.filter((id) => selected.includes(id)) : [grabbed];
}

/** Where a dragged group lands among the slides left after it is lifted out, given the thumbnail it was dropped on. */
export function dropIndex(order: string[], moving: string[], overId: string): number | null {
  if (moving.includes(overId) || !order.includes(overId)) return null;
  const others = order.filter((id) => !moving.includes(id));
  const first = Math.min(...moving.map((id) => order.indexOf(id)));
  const at = others.indexOf(overId);
  return first < order.indexOf(overId) ? at + 1 : at;
}
