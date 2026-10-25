// Whiteboard and document labs ("studio" labs): non-code work checked by the
// app, by the learner, or by a mentor. Pure types.

import type { RichDoc } from "./types";

export type StudioKind = "canvas" | "document";

export type CanvasItemType = "sticky" | "text" | "shape" | "image" | "pin";
export type StickyColor = "yellow" | "pink" | "green" | "blue" | "purple";

export interface CanvasItem {
  id: string;
  type: CanvasItemType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color?: StickyColor;
  src?: string;
  alt?: string;
  /** Starter items only. Learners can't move or change locked items. */
  locked?: boolean;
  /** Set on learner copies of starter items, so checks count only the learner's own work. */
  fromStarter?: boolean;
}

/** An area on the starter board the learner should find, e.g. a usability problem. Hidden from learners. */
export interface Hotspot {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AutoRule =
  | { kind: "item-count"; itemType: CanvasItemType | "any"; color?: StickyColor; min: number }
  | { kind: "hotspots"; min: number }
  | { kind: "contains-text"; text: string }
  | { kind: "word-count"; min: number }
  | { kind: "section"; heading: string; minWords: number }
  | { kind: "list-items"; heading: string; min: number };

export type AutoRuleKind = AutoRule["kind"];

/** How a criterion is checked: by the app, ticked by the learner, or approved by a mentor. */
export type CheckMode = "auto" | "self" | "mentor";

export interface Criterion {
  id: string;
  label: string;
  description?: string;
  mode: CheckMode;
  /** Required when mode is auto. */
  rule?: AutoRule;
}

export interface StudioLab {
  kind: StudioKind;
  title: string;
  /** Plain text brief shown to the learner. Blank lines separate paragraphs. */
  brief: string;
  criteria: Criterion[];
  canvas?: { items: CanvasItem[]; hotspots: Hotspot[] };
  document?: { template: RichDoc };
}

export interface StudioWork {
  items?: CanvasItem[];
  doc?: RichDoc;
}

export type SubmissionStatus = "in-progress" | "submitted" | "approved" | "changes-requested";

export type CriterionState = "pass" | "fail" | "pending";

export interface CriterionResult {
  criterion: Criterion;
  state: CriterionState;
  /** Short progress text for automatic checks, e.g. "3 of 4". */
  detail?: string;
}
