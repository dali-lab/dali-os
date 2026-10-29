import type { CSSProperties } from "react";

// Per-column accent for a kanban: a soft column-header fill, the ink on it, and
// the saturated edge for a card's left border. CSS values rather than classes
// because app.css closes with an unlayered `* { border-color: ... }` that
// outranks every border-colour utility, so an inline style is what wins.

export type StatusAccent = { fill: string; ink: string; edge: string; dot?: string };

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
  fill: `var(--os-status-${name}-header, var(--os-status-${name}-fill))`,
  ink: `var(--os-status-${name}-header-ink, var(--os-status-${name}-ink))`,
  edge: `var(--os-status-${name}-edge)`,
  dot: `var(--os-status-${name}-dot, var(--os-status-${name}-edge))`,
});

// A column title in the header's ink. Under v2 `.os-board-title` leads it with
// the stage dot (app.css); elsewhere the class draws nothing.
export const BOARD_TITLE_CLASS = "os-board-title";

export const boardTitleStyle = (accent: StatusAccent): CSSProperties =>
  ({ color: accent.ink, "--os-board-dot": accent.dot ?? accent.edge }) as CSSProperties;
