import { safeImageUrl } from "./clipboard";
import { placementOf, type Placed } from "./freeform";
import type { RenderElement, RenderSlide } from "./snapshot";
import type { ThemeDef } from "./themes";

export const BACKGROUND_TOKENS = ["ground", "surface", "accent", "fg", "muted", "rule"] as const;
export type BackgroundToken = (typeof BACKGROUND_TOKENS)[number];
export const BACKGROUND_LABELS: Record<BackgroundToken, string> = { ground: "Default", surface: "Surface", accent: "Accent", fg: "Text", muted: "Muted", rule: "Rule" };

export type BackgroundFit = "cover" | "contain";
export type SlideBackground = { kind: "color"; token: BackgroundToken } | { kind: "image"; url: string; fit: BackgroundFit };

export const TRANSITION_KINDS = ["none", "dissolve", "push", "magic"] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];
export const TRANSITION_LABELS: Record<TransitionKind, string> = { none: "None", dissolve: "Dissolve", push: "Push", magic: "Magic Move" };
export interface SlideTransition {
  kind: TransitionKind;
  duration?: number;
}

export const MIN_TRANSITION_MS = 100;
export const MAX_TRANSITION_MS = 3000;
export const DEFAULT_TRANSITION_MS: Record<TransitionKind, number> = { none: 0, dissolve: 500, push: 450, magic: 700 };
export const MAX_SECTION_NAME = 80;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function cleanBackground(raw: unknown): SlideBackground | null {
  if (!isObj(raw)) return null;
  if (raw.kind === "color" && BACKGROUND_TOKENS.includes(raw.token as BackgroundToken)) return { kind: "color", token: raw.token as BackgroundToken };
  if (raw.kind === "image") {
    const url = safeImageUrl(raw.url);
    if (url) return { kind: "image", url, fit: raw.fit === "contain" ? "contain" : "cover" };
  }
  return null;
}

export function cleanTransition(raw: unknown): SlideTransition | null {
  if (!isObj(raw) || !TRANSITION_KINDS.includes(raw.kind as TransitionKind)) return null;
  const kind = raw.kind as TransitionKind;
  if (kind === "none") return null;
  const d = raw.duration;
  const duration = typeof d === "number" && Number.isFinite(d) ? Math.round(Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, d))) : undefined;
  return { kind, ...(duration !== undefined ? { duration } : {}) };
}

export function cleanSection(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_SECTION_NAME);
  return name || null;
}

export function slideMetaFields(read: (key: string) => unknown) {
  const background = cleanBackground(read("background"));
  const transition = cleanTransition(read("transition"));
  const section = cleanSection(read("section"));
  return {
    ...(background ? { background } : {}),
    ...(transition ? { transition } : {}),
    ...(section ? { section } : {}),
  };
}

export const transitionDuration = (t: SlideTransition) => t.duration ?? DEFAULT_TRANSITION_MS[t.kind];

/** What plays when arriving at a slide. Reduced motion, a missing transition or a first slide all mean nothing plays. */
export function effectiveTransition(t: SlideTransition | undefined, reducedMotion: boolean): SlideTransition | null {
  if (!t || t.kind === "none" || reducedMotion) return null;
  return { kind: t.kind, duration: transitionDuration(t) };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function backgroundColorFor(theme: ThemeDef, token: BackgroundToken): string {
  return theme.colors[token];
}

export interface Section {
  name: string;
  slideIds: string[];
  firstId: string;
}

/** Sections in order. Slides before the first named slide belong to no section and are returned as `lead`. */
export function sectionsOf(slides: Array<{ id: string; section?: string }>): { lead: string[]; sections: Section[] } {
  const lead: string[] = [];
  const sections: Section[] = [];
  for (const s of slides) {
    if (s.section) sections.push({ name: s.section, slideIds: [s.id], firstId: s.id });
    else if (sections.length) sections[sections.length - 1].slideIds.push(s.id);
    else lead.push(s.id);
  }
  return { lead, sections };
}

const textKey = (el: RenderElement) => JSON.stringify(el.blocks);

function contentKey(el: RenderElement): string | null {
  switch (el.kind) {
    case "text":
      return el.blocks.length ? textKey(el) : null;
    case "image":
      return el.src ? el.src : null;
    case "chart":
      return el.chart ? JSON.stringify(el.chart) : null;
    case "icon":
      return el.icon ?? null;
    case "video":
      return el.videoUrl ?? null;
    default:
      return null;
  }
}

/** Which element of `from` each element of `to` continues: the same id and kind first, then the same kind and content. */
export function matchElements(from: RenderSlide, to: RenderSlide): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const movable = (e: RenderElement) => e.kind !== "group";
  const fromEls = from.elements.filter(movable);
  for (const el of to.elements.filter(movable)) {
    const same = fromEls.find((f) => f.id === el.id && f.kind === el.kind && !used.has(f.id));
    if (same) (out.set(el.id, same.id), used.add(same.id));
  }
  for (const el of to.elements.filter(movable)) {
    if (out.has(el.id)) continue;
    const key = contentKey(el);
    if (!key) continue;
    const twin = fromEls.find((f) => !used.has(f.id) && f.kind === el.kind && contentKey(f) === key);
    if (twin) (out.set(el.id, twin.id), used.add(twin.id));
  }
  return out;
}

export interface MorphPlan {
  /** Where each continuing element of the new slide starts, taken from the old slide. */
  starts: Map<string, Placed>;
  /** Elements only the new slide has: they fade in. */
  entering: Set<string>;
  /** Elements only the old slide has: they fade out. */
  leaving: Set<string>;
  /** Old elements that continue, hidden on the outgoing layer. */
  continuing: Set<string>;
}

export function planMorph(from: RenderSlide, to: RenderSlide): MorphPlan {
  const matches = matchElements(from, to);
  const starts = new Map<string, Placed>();
  const fromById = new Map(from.elements.map((e) => [e.id, e]));
  for (const [toId, fromId] of matches) {
    const el = fromById.get(fromId);
    const placed = el && placementOf(from.layoutId, el);
    if (placed) starts.set(toId, placed);
  }
  const continuing = new Set(matches.values());
  const entering = new Set(to.elements.filter((e) => e.kind !== "group" && !starts.has(e.id)).map((e) => e.id));
  const leaving = new Set(from.elements.filter((e) => e.kind !== "group" && !continuing.has(e.id)).map((e) => e.id));
  return { starts, entering, leaving, continuing };
}
