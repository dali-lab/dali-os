export interface Combo {
  key: string;
  mod?: boolean;
  shift?: boolean;
  anyShift?: boolean;
}

export type ShortcutGroup = "Editing" | "Selection" | "Arrange" | "Clipboard" | "While dragging" | "Presenting";

export interface ShortcutDef {
  id: string;
  label: string;
  group: ShortcutGroup;
  combos?: Combo[];
  display?: string[][];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["Editing", "Selection", "Arrange", "Clipboard", "While dragging", "Presenting"];

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: "undo", label: "Undo", group: "Editing", combos: [{ key: "z", mod: true }] },
  { id: "redo", label: "Redo", group: "Editing", combos: [{ key: "z", mod: true, shift: true }, { key: "y", mod: true }] },
  { id: "find", label: "Find and replace", group: "Editing", combos: [{ key: "f", mod: true }] },
  { id: "help", label: "Keyboard shortcuts", group: "Editing", combos: [{ key: "?", anyShift: true }] },
  { id: "editItem", label: "Edit the selected text or crop the selected picture", group: "Editing", display: [["Enter"]] },
  { id: "stepOut", label: "Step out of text or crop, then deselect", group: "Editing", display: [["Esc"]] },
  { id: "zoomIn", label: "Zoom in", group: "Editing", display: [["mod", "+"]] },
  { id: "zoomOut", label: "Zoom out", group: "Editing", display: [["mod", "−"]] },
  { id: "zoomFit", label: "Fit the slide to the window", group: "Editing", display: [["mod", "0"]] },
  { id: "selectAll", label: "Select all", group: "Selection", combos: [{ key: "a", mod: true }] },
  { id: "deselect", label: "Deselect", group: "Selection", combos: [{ key: "Escape" }] },
  { id: "addToSelection", label: "Add to selection", group: "Selection", display: [["Shift", "Click"]] },
  { id: "nudge", label: "Nudge", group: "Arrange", display: [["←", "↑", "→", "↓"]] },
  { id: "nudgeBig", label: "Nudge by more", group: "Arrange", display: [["Shift", "←", "↑", "→", "↓"]] },
  { id: "duplicate", label: "Duplicate", group: "Arrange", combos: [{ key: "d", mod: true }] },
  { id: "group", label: "Group", group: "Arrange", combos: [{ key: "g", mod: true }] },
  { id: "ungroup", label: "Ungroup", group: "Arrange", combos: [{ key: "g", mod: true, shift: true }] },
  { id: "forward", label: "Bring forward", group: "Arrange", combos: [{ key: "]", mod: true }] },
  { id: "backward", label: "Send backward", group: "Arrange", combos: [{ key: "[", mod: true }] },
  { id: "front", label: "Bring to front", group: "Arrange", combos: [{ key: "]", mod: true, shift: true }] },
  { id: "back", label: "Send to back", group: "Arrange", combos: [{ key: "[", mod: true, shift: true }] },
  { id: "delete", label: "Delete", group: "Arrange", display: [["Delete"], ["Backspace"]] },
  { id: "copy", label: "Copy", group: "Clipboard", combos: [{ key: "c", mod: true }] },
  { id: "cut", label: "Cut", group: "Clipboard", combos: [{ key: "x", mod: true }] },
  { id: "paste", label: "Paste", group: "Clipboard", combos: [{ key: "v", mod: true }] },
  { id: "copyStyle", label: "Copy style", group: "Clipboard", display: [["mod", "Option", "C"]] },
  { id: "pasteStyle", label: "Paste style", group: "Clipboard", display: [["mod", "Option", "V"]] },
  { id: "dragCopy", label: "Drag a copy and leave the original", group: "While dragging", display: [["Option"]] },
  { id: "showDistance", label: "Show distance to the item under the pointer", group: "While dragging", display: [["Option", "Hover"]] },
  { id: "skipSnap", label: "Skip snapping", group: "While dragging", display: [["mod"]] },
  { id: "constrain", label: "Keep proportions, snap the angle or lock the axis", group: "While dragging", display: [["Shift"]] },
  { id: "presentNext", label: "Next step or slide", group: "Presenting", display: [["→"], ["Space"], ["Page Down"]] },
  { id: "presentPrev", label: "Previous step or slide", group: "Presenting", display: [["←"], ["Page Up"]] },
  { id: "presentFirst", label: "First slide", group: "Presenting", display: [["Home"]] },
  { id: "presentLast", label: "Last slide", group: "Presenting", display: [["End"]] },
  { id: "presentExit", label: "Leave the slide show", group: "Presenting", display: [["Esc"]] },
];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

export function comboMatches(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, combo: Combo): boolean {
  if (e.altKey) return false;
  if ((e.metaKey || e.ctrlKey) !== Boolean(combo.mod)) return false;
  if (!combo.anyShift && e.shiftKey !== Boolean(combo.shift)) return false;
  return e.key.toLowerCase() === combo.key.toLowerCase();
}

export function shortcutFor(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): string | null {
  for (const def of SHORTCUTS) if (def.combos?.some((c) => comboMatches(e, c))) return def.id;
  return null;
}

export function formatCombo(combo: Combo, mac: boolean): string[] {
  const key = combo.key === "Escape" ? "Esc" : combo.key.length === 1 ? combo.key.toUpperCase() : combo.key;
  return [...(combo.shift ? [mac ? "⇧" : "Shift"] : []), ...(combo.mod ? [mac ? "⌘" : "Ctrl"] : []), key];
}

export function keysOf(def: ShortcutDef, mac: boolean): string[][] {
  if (def.combos) return def.combos.map((c) => formatCombo(c, mac));
  return (def.display ?? []).map((keys) => keys.map((k) => (k === "mod" ? (mac ? "⌘" : "Ctrl") : k)));
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
