// Per-column accent for a kanban: a soft column-header fill, the ink on it, and
// the saturated edge for a card's left border. CSS values rather than classes
// because app.css closes with an unlayered `* { border-color: ... }` that
// outranks every border-colour utility, so an inline style is what wins.

export type StatusAccent = { fill: string; ink: string; edge: string };

// The OS shell's status token families (see app.css `--os-status-*`). A board
// maps its own columns onto these so every kanban reads as one system.
export type OsStatusToken =
  | "backlog"
  | "todo"
  | "progress"
  | "review"
  | "done"
  | "cancelled";

export const osStatusAccent = (name: OsStatusToken): StatusAccent => ({
  fill: `var(--os-status-${name}-fill)`,
  ink: `var(--os-status-${name}-ink)`,
  edge: `var(--os-status-${name}-edge)`,
});
