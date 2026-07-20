// Task.checklist helpers shared by the task modal (client) and the PATCH
// route (server). Rules mirror the MCP set_task_checklist tool: items are
// `{ text, done }`, text is trimmed, empties are dropped, and both item count
// and text length are capped.

export const CHECKLIST_MAX_ITEMS = 100;
export const CHECKLIST_MAX_TEXT = 500;

export type ChecklistItem = { text: string; done: boolean };

/**
 * Validate an untrusted checklist payload. Returns the normalized items
 * (trimmed text, empties dropped, `done` coerced to boolean) or null when
 * the shape is invalid (not an array, bad item shape, over either cap).
 */
export function parseChecklistInput(value: unknown): ChecklistItem[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > CHECKLIST_MAX_ITEMS) return null;
  const out: ChecklistItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.text !== "string") return null;
    if (o.done !== undefined && typeof o.done !== "boolean") return null;
    if (o.text.length > CHECKLIST_MAX_TEXT) return null;
    const text = o.text.trim();
    if (!text) continue;
    out.push({ text, done: !!o.done });
  }
  return out;
}

/**
 * Soft normalization for trusted (already well-shaped) client state before
 * it goes into a patch: trim, drop empties, cap length and count.
 */
export function normalizeChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return items
    .map((it) => ({ text: it.text.trim().slice(0, CHECKLIST_MAX_TEXT), done: !!it.done }))
    .filter((it) => it.text.length > 0)
    .slice(0, CHECKLIST_MAX_ITEMS);
}
