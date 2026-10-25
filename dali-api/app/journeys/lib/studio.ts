// Whiteboard and document labs: defaults, the learner's starting work, and the
// automatic checks. Pure, so the browser and the server grade work the same way.

import { createId } from "~/lib/short-id";
import type { RichDoc } from "./types";
import type {
  AutoRule,
  AutoRuleKind,
  CanvasItem,
  CanvasItemType,
  CheckMode,
  Criterion,
  CriterionResult,
  Hotspot,
  StickyColor,
  StudioKind,
  StudioLab,
  StudioWork,
  SubmissionStatus,
} from "./studio-types";

/** Sticky note fills. Paper colours on purpose: the board is a light surface in both themes. */
export const STICKY_COLORS: Record<StickyColor, string> = {
  yellow: "#FFE58A",
  pink: "#FFC2CF",
  green: "#BDE5A8",
  blue: "#B6DCE6",
  purple: "#D9C8F2",
};

export const KIND_LABELS: Record<StudioKind, string> = { canvas: "Whiteboard", document: "Document" };

export const MODE_LABELS: Record<CheckMode, string> = { auto: "Automatic", self: "Self-check", mentor: "Mentor review" };

export const ITEM_TYPE_LABELS: Record<CanvasItemType | "any", string> = {
  any: "items",
  sticky: "sticky notes",
  text: "text labels",
  shape: "shapes",
  image: "images",
  pin: "comment pins",
};

export const RULE_KINDS_FOR: Record<StudioKind, { kind: AutoRuleKind; label: string }[]> = {
  canvas: [
    { kind: "item-count", label: "Adds at least N items" },
    { kind: "hotspots", label: "Pins the hidden problem areas" },
    { kind: "contains-text", label: "Board mentions a phrase" },
  ],
  document: [
    { kind: "section", label: "Section has enough words" },
    { kind: "list-items", label: "Section has enough list items" },
    { kind: "word-count", label: "Whole document word count" },
    { kind: "contains-text", label: "Document mentions a phrase" },
  ],
};

export function defaultRule(kind: AutoRuleKind): AutoRule {
  switch (kind) {
    case "item-count":
      return { kind, itemType: "sticky", min: 3 };
    case "hotspots":
      return { kind, min: 3 };
    case "contains-text":
      return { kind, text: "" };
    case "word-count":
      return { kind, min: 100 };
    case "section":
      return { kind, heading: "", minWords: 20 };
    case "list-items":
      return { kind, heading: "", min: 2 };
  }
}

export function createCriterion(mode: CheckMode, studioKind: StudioKind): Criterion {
  return {
    id: createId("crit"),
    label: "",
    mode,
    rule: mode === "auto" ? defaultRule(RULE_KINDS_FOR[studioKind][0].kind) : undefined,
  };
}

const heading = (text: string): RichDoc[number] => ({ type: "heading", props: { level: 3 }, content: [{ type: "text", text, styles: {} }] });

export function createStudio(kind: StudioKind): StudioLab {
  if (kind === "canvas") {
    return {
      kind,
      title: "Whiteboard exercise",
      brief: "",
      criteria: [
        { id: createId("crit"), label: "Add at least 3 sticky notes", mode: "auto", rule: { kind: "item-count", itemType: "sticky", min: 3 } },
        { id: createId("crit"), label: "A mentor has reviewed the board", mode: "mentor" },
      ],
      canvas: { items: [], hotspots: [] },
    };
  }
  return {
    kind,
    title: "Writing exercise",
    brief: "",
    criteria: [
      { id: createId("crit"), label: "Write at least 100 words", mode: "auto", rule: { kind: "word-count", min: 100 } },
      { id: createId("crit"), label: "A mentor has reviewed the document", mode: "mentor" },
    ],
    document: { template: [heading("Heading"), { type: "paragraph", content: [] }] },
  };
}

/** The learner's starting point: a copy of the starter board or the document template. */
export function initialWork(studio: StudioLab): StudioWork {
  if (studio.kind === "canvas") {
    return { items: (studio.canvas?.items ?? []).map((i) => ({ ...i, fromStarter: true })) };
  }
  return { doc: studio.document?.template ?? [] };
}

/** A new item centred on (x, y), the point the user clicked. */
export function createCanvasItem(type: CanvasItemType, x: number, y: number, color: StickyColor = "yellow"): CanvasItem {
  const id = createId(type);
  switch (type) {
    case "sticky":
      return { id, type, x: x - 90, y: y - 90, width: 180, height: 180, text: "", color };
    case "text":
      return { id, type, x: x - 20, y: y - 16, text: "" };
    case "shape":
      return { id, type, x: x - 100, y: y - 60, width: 200, height: 120, text: "" };
    case "pin":
      return { id, type, x: x - PIN_RADIUS, y: y - PIN_RADIUS, text: "" };
    case "image":
      return { id, type, x: x - 160, y: y - 120, width: 320, height: 240, src: "", alt: "" };
  }
}

export function createHotspot(x: number, y: number): Hotspot {
  return { id: createId("hotspot"), label: "", x: x - 80, y: y - 50, width: 160, height: 100 };
}

// ─── Checking ────────────────────────────────────────────────────────────────

/** A pin's position is its top-left corner; it points at its centre. */
export const PIN_RADIUS = 14;

function words(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

type LooseBlock = { type?: string; content?: unknown; children?: LooseBlock[] };

function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: { type?: string; text?: string; content?: unknown }) => (c?.type === "link" ? inlineText(c.content) : (c?.text ?? "")))
    .join("");
}

function blockText(block: LooseBlock): string {
  return [inlineText(block.content), ...(block.children ?? []).map(blockText)].filter(Boolean).join(" ");
}

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem", "toggleListItem"]);

function listItems(block: LooseBlock): LooseBlock[] {
  const nested = (block.children ?? []).flatMap(listItems);
  return LIST_TYPES.has(block.type ?? "") ? [block, ...nested] : nested;
}

/** Top-level blocks after the heading that mentions `title`, up to the next heading. */
function sectionBlocks(doc: RichDoc, title: string): LooseBlock[] | null {
  const target = title.trim().toLowerCase();
  if (!target) return null;
  const blocks = doc as LooseBlock[];
  const start = blocks.findIndex((b) => b.type === "heading" && inlineText(b.content).trim().toLowerCase().includes(target));
  if (start === -1) return null;
  const rest = blocks.slice(start + 1);
  const end = rest.findIndex((b) => b.type === "heading");
  return end === -1 ? rest : rest.slice(0, end);
}

function workText(studio: StudioLab, work: StudioWork): string {
  if (studio.kind === "canvas") return (work.items ?? []).map((i) => i.text ?? "").join(" ");
  return ((work.doc ?? []) as LooseBlock[]).map(blockText).join(" ");
}

function pinInside(pin: CanvasItem, h: Hotspot): boolean {
  const cx = pin.x + PIN_RADIUS;
  const cy = pin.y + PIN_RADIUS;
  return cx >= h.x && cx <= h.x + h.width && cy >= h.y && cy <= h.y + h.height;
}

/** Hotspots the learner has dropped one of their own pins on. */
export function foundHotspots(studio: StudioLab, work: StudioWork): Set<string> {
  const pins = (work.items ?? []).filter((i) => i.type === "pin" && !i.fromStarter);
  return new Set((studio.canvas?.hotspots ?? []).filter((h) => pins.some((p) => pinInside(p, h))).map((h) => h.id));
}

export function evaluateRule(rule: AutoRule, studio: StudioLab, work: StudioWork): { passed: boolean; detail?: string } {
  switch (rule.kind) {
    case "item-count": {
      const n = (work.items ?? []).filter(
        (i) => !i.fromStarter && (rule.itemType === "any" || i.type === rule.itemType) && (!rule.color || i.color === rule.color),
      ).length;
      return { passed: n >= rule.min, detail: `${Math.min(n, rule.min)} of ${rule.min}` };
    }
    case "hotspots": {
      const n = foundHotspots(studio, work).size;
      return { passed: n >= rule.min, detail: `${Math.min(n, rule.min)} of ${rule.min} found` };
    }
    case "contains-text": {
      const phrase = rule.text.trim().toLowerCase();
      return { passed: Boolean(phrase) && workText(studio, work).toLowerCase().includes(phrase) };
    }
    case "word-count": {
      const n = words(workText(studio, work));
      return { passed: n >= rule.min, detail: `${n} of ${rule.min} words` };
    }
    case "section": {
      const blocks = sectionBlocks(work.doc ?? [], rule.heading);
      if (!blocks) return { passed: false, detail: "Section missing" };
      const n = words(blocks.map(blockText).join(" "));
      return { passed: n >= rule.minWords, detail: `${n} of ${rule.minWords} words` };
    }
    case "list-items": {
      const blocks = sectionBlocks(work.doc ?? [], rule.heading);
      if (!blocks) return { passed: false, detail: "Section missing" };
      const n = blocks.flatMap(listItems).filter((b) => inlineText(b.content).trim()).length;
      return { passed: n >= rule.min, detail: `${Math.min(n, rule.min)} of ${rule.min} items` };
    }
  }
}

export function evaluateCriteria(
  studio: StudioLab,
  work: StudioWork,
  selfChecks: Record<string, boolean>,
  mentorChecks: Record<string, boolean>,
  status: SubmissionStatus,
): CriterionResult[] {
  return studio.criteria.map((criterion) => {
    if (criterion.mode === "auto") {
      if (!criterion.rule) return { criterion, state: "fail" };
      const { passed, detail } = evaluateRule(criterion.rule, studio, work);
      return { criterion, state: passed ? "pass" : "fail", detail };
    }
    if (criterion.mode === "self") return { criterion, state: selfChecks[criterion.id] ? "pass" : "fail" };
    if (status === "approved") return { criterion, state: "pass" };
    if (status === "changes-requested") return { criterion, state: mentorChecks[criterion.id] ? "pass" : "fail" };
    return { criterion, state: "pending" };
  });
}

/** Automatic checks and self-checks are what the learner controls before review. */
export function readyForReview(results: CriterionResult[]): boolean {
  return results.filter((r) => r.criterion.mode !== "mentor").every((r) => r.state === "pass");
}

export function needsMentor(studio: StudioLab): boolean {
  return studio.criteria.some((c) => c.mode === "mentor");
}

export function describeRule(rule: AutoRule): string {
  switch (rule.kind) {
    case "item-count":
      return `At least ${rule.min} ${rule.color ? `${rule.color} ` : ""}${ITEM_TYPE_LABELS[rule.itemType]} added by the learner`;
    case "hotspots":
      return `Comment pins placed in at least ${rule.min} of the hidden problem areas`;
    case "contains-text":
      return rule.text.trim() ? `Mentions "${rule.text.trim()}"` : "Mentions a phrase";
    case "word-count":
      return `At least ${rule.min} words in total`;
    case "section":
      return `"${rule.heading || "..."}" section has at least ${rule.minWords} words`;
    case "list-items":
      return `"${rule.heading || "..."}" section lists at least ${rule.min} items`;
  }
}

/** Problems that block publishing a studio lab, without the module name prefix. */
export function studioIssues(studio: StudioLab): string[] {
  const issues: string[] = [];
  if (!studio.title.trim()) issues.push("the lab needs a title.");
  if (studio.criteria.length === 0) issues.push("the lab needs at least one criterion.");
  studio.criteria.forEach((c, i) => {
    const label = `lab criterion ${i + 1}`;
    if (!c.label.trim()) issues.push(`${label} has no text.`);
    const r = c.mode === "auto" ? c.rule : undefined;
    if (c.mode === "auto" && !r) issues.push(`${label} has no automatic check set up.`);
    if ((r?.kind === "section" || r?.kind === "list-items") && !r.heading.trim()) issues.push(`${label} needs a heading to look for.`);
    if (r?.kind === "contains-text" && !r.text.trim()) issues.push(`${label} needs a phrase to look for.`);
    if (r?.kind === "hotspots" && r.min > (studio.canvas?.hotspots.length ?? 0)) {
      issues.push(`${label} asks for more problem areas than the board has.`);
    }
  });
  return issues;
}
