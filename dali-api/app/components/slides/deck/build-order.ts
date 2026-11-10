import { blocksToPlainText } from "~/components/doc/schema/configs";
import { autoDelayAt, effectOf, isBuilt, MAX_BUILD_DELAY, spanOf, startOf, type BuildEffect } from "./builds";
import type { RenderElement, RenderSlide } from "./snapshot";

export type BuildMode = "click" | "with" | "after";

export interface BuildRow {
  id: string;
  kind: string;
  label: string;
  start: number;
  span: number;
  mode: BuildMode;
  delay: number;
  effect: BuildEffect;
  bullets: boolean;
}

export interface BuildPatch {
  build: number | null;
  buildAfter: boolean;
  buildDelay: number | null;
  buildBullets?: false;
  buildEffect?: null;
}

const KIND_LABEL: Record<string, string> = {
  text: "Text",
  image: "Image",
  shape: "Shape",
  chart: "Chart",
  icon: "Icon",
  video: "Video",
  poll: "Poll",
  group: "Group",
};
const LABEL_MAX = 28;

export function elementLabel(el: RenderElement): string {
  const text = el.kind === "text" ? blocksToPlainText(el.blocks as never).replace(/\s+/g, " ").trim() : "";
  if (text) return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
  if (el.kind === "poll" && el.poll?.question) return el.poll.question.slice(0, LABEL_MAX);
  return KIND_LABEL[el.kind] ?? "Element";
}

/** The slide's build items in the order they appear, with items sharing a step marked as appearing with the one before. */
export function buildRows(slide: RenderSlide): BuildRow[] {
  const built = slide.elements.filter((e) => isBuilt(e) && e.kind !== "group").sort((a, b) => startOf(a) - startOf(b) || a.z - b.z || a.id.localeCompare(b.id));
  return built.map((el, i) => {
    const start = startOf(el);
    const first = i === 0 || startOf(built[i - 1]) !== start;
    const auto = autoDelayAt(slide, start);
    return {
      id: el.id,
      kind: el.kind,
      label: elementLabel(el),
      start,
      span: spanOf(el),
      mode: !first ? "with" : auto !== null ? "after" : "click",
      delay: auto ?? 0,
      effect: effectOf(el),
      bullets: el.buildBullets === true,
    };
  });
}

export function reorderRows<T extends { id: string }>(rows: T[], activeId: string, overId: string): T[] {
  const from = rows.findIndex((r) => r.id === activeId);
  const to = rows.findIndex((r) => r.id === overId);
  if (from < 0 || to < 0 || from === to) return rows;
  const next = rows.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The rows without one item. If it led a step, the next item sharing that step takes over the step's start and delay. */
export function withoutRow<T extends Pick<BuildRow, "id" | "mode" | "delay">>(rows: T[], id: string): T[] {
  const at = rows.findIndex((r) => r.id === id);
  if (at < 0) return rows;
  const gone = rows[at];
  const next = rows[at + 1];
  const rest = rows.filter((r) => r.id !== id);
  if (gone.mode === "with" || !next || next.mode !== "with") return rest;
  return rest.map((r) => (r.id === next.id ? { ...r, mode: gone.mode, delay: gone.delay } : r));
}

export const clampDelay = (ms: number) => (Number.isFinite(ms) ? Math.min(MAX_BUILD_DELAY, Math.max(0, Math.round(ms))) : 0);

/** Step numbers for rows in their given order. Rows marked "with" share the step of the row before; every other row starts after the longest row of the step before it. */
export function planBuilds(rows: Array<Pick<BuildRow, "id" | "mode" | "span" | "delay">>): Record<string, BuildPatch> {
  const out: Record<string, BuildPatch> = {};
  let groupStart = 1;
  let groupEnd = 1;
  let auto = false;
  let delay = 0;
  const members: string[] = [];
  const flush = () => {
    for (const id of members) out[id] = { build: out[id].build, buildAfter: auto, buildDelay: auto && delay > 0 ? delay : null };
    members.length = 0;
  };
  rows.forEach((row, i) => {
    if (row.mode === "with" && i > 0) {
      groupEnd = Math.max(groupEnd, groupStart + row.span);
    } else {
      flush();
      groupStart = groupEnd;
      groupEnd = groupStart + row.span;
      auto = row.mode === "after";
      delay = clampDelay(row.delay);
    }
    out[row.id] = { build: groupStart, buildAfter: false, buildDelay: null };
    members.push(row.id);
  });
  flush();
  return out;
}

export const REMOVED: BuildPatch = { build: null, buildAfter: false, buildDelay: null, buildBullets: false, buildEffect: null };
