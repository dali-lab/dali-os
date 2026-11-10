export interface EditState {
  selection: string[];
  editingId: string | null;
  cropId: string | null;
}

export const IDLE: EditState = { selection: [], editingId: null, cropId: null };

export type EditEvent =
  | { type: "click"; id: string; shift?: boolean }
  | { type: "dblclick"; id: string }
  | { type: "enter" }
  | { type: "escape" }
  | { type: "background"; shift?: boolean };

export interface EditFacts {
  kindOf: (id: string) => string | undefined;
  locked: (id: string) => boolean;
}

/**
 * How selection and the two inner modes move: a click selects, a double click or Enter goes inside (text edits,
 * an image crops), Escape steps out one level, and a click on the background clears everything.
 */
export function reduceEditing(state: EditState, event: EditEvent, facts: EditFacts): EditState {
  const inside = (id: string): EditState => {
    const kind = facts.kindOf(id);
    if (facts.locked(id)) return { selection: [id], editingId: null, cropId: null };
    if (kind === "text") return { selection: [id], editingId: id, cropId: null };
    if (kind === "image") return { selection: [id], editingId: null, cropId: id };
    if (kind === "html") return { selection: [id], editingId: id, cropId: null };
    return { selection: [id], editingId: null, cropId: null };
  };
  switch (event.type) {
    case "click": {
      if (event.shift) {
        const has = state.selection.includes(event.id);
        return { selection: has ? state.selection.filter((s) => s !== event.id) : [...state.selection, event.id], editingId: null, cropId: null };
      }
      return { selection: [event.id], editingId: null, cropId: null };
    }
    case "dblclick":
      return inside(event.id);
    case "enter":
      return state.selection.length === 1 && !state.editingId && !state.cropId ? inside(state.selection[0]) : state;
    case "escape":
      if (state.editingId) return { ...state, editingId: null };
      if (state.cropId) return { ...state, cropId: null };
      return IDLE;
    case "background":
      return event.shift ? { ...state, editingId: null, cropId: null } : IDLE;
  }
}

/** What a right click leaves selected: the selection it landed in, else just the thing under the pointer. */
export function contextSelection(selection: string[], target: string): string[] {
  return selection.includes(target) ? selection : [target];
}
