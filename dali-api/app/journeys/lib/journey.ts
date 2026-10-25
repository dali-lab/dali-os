import { countWords } from "~/components/doc/blocks-util";
import type { Journey, JourneyModule, ModuleStatus, RichDoc } from "./types";

export type ActivityKind = "lab" | "quiz";

/** Progress key for a module's lab or quiz, stored next to completed module ids. */
export function activityKey(moduleId: string, kind: ActivityKind): string {
  return `${moduleId}#${kind}`;
}

export function hasLab(mod: Pick<JourneyModule, "lab" | "studio">): boolean {
  return Boolean(mod.lab || mod.studio);
}

export interface LabInfo {
  kind: "code" | "canvas" | "document";
  title: string;
  meta: string;
}

/** A module's lab of any kind: code project, whiteboard or document. */
export function getLabInfo(mod: JourneyModule): LabInfo | null {
  if (mod.lab) return { kind: "code", title: mod.lab.title, meta: `${mod.lab.steps.length} guided steps` };
  if (mod.studio) {
    const n = mod.studio.criteria.length;
    const label = mod.studio.kind === "canvas" ? "Whiteboard" : "Document";
    const review = mod.studio.criteria.some((c) => c.mode === "mentor") ? " · mentor review" : "";
    return { kind: mod.studio.kind, title: mod.studio.title, meta: `${label} · ${n} ${n === 1 ? "check" : "checks"}${review}` };
  }
  return null;
}

/** Every key a learner can record against this journey. */
export function progressKeys(journey: Pick<Journey, "modules">): Set<string> {
  const keys = new Set<string>();
  for (const m of journey.modules) {
    keys.add(m.id);
    if (hasLab(m)) keys.add(activityKey(m.id, "lab"));
    if (m.quiz) keys.add(activityKey(m.id, "quiz"));
  }
  return keys;
}

export function getModule(journey: Pick<Journey, "modules">, moduleId: string | undefined): JourneyModule | undefined {
  return journey.modules.find((m) => m.id === moduleId);
}

export function getModuleStatus(mod: JourneyModule, completed: ReadonlySet<string>): ModuleStatus {
  if (completed.has(mod.id)) return "completed";
  return mod.dependsOn.every((dep) => completed.has(dep)) ? "available" : "locked";
}

/** Modules that finishing `moduleId` would open up, given what is already done. */
export function getNewlyUnlocked(
  journey: Pick<Journey, "modules">,
  moduleId: string,
  completed: ReadonlySet<string>,
): JourneyModule[] {
  const next = new Set(completed).add(moduleId);
  return journey.modules.filter(
    (m) => m.dependsOn.includes(moduleId) && !next.has(m.id) && m.dependsOn.every((dep) => next.has(dep)),
  );
}

export function getJourneyProgress(
  journey: Pick<Journey, "modules">,
  completed: ReadonlySet<string>,
): { done: number; total: number } {
  return {
    done: journey.modules.filter((m) => completed.has(m.id)).length,
    total: journey.modules.length,
  };
}

/** The first module the learner can open next, in authoring order. */
export function nextAvailableModule(
  journey: Pick<Journey, "modules">,
  completed: ReadonlySet<string>,
): JourneyModule | undefined {
  return journey.modules.find((m) => getModuleStatus(m, completed) === "available");
}

export function startModule(journey: Pick<Journey, "modules">): JourneyModule | undefined {
  return journey.modules.find((m) => m.dependsOn.length === 0);
}

export function parseMinutes(duration: string): number {
  const hours = /(\d+)\s*h/i.exec(duration);
  const mins = /(\d+)\s*m/i.exec(duration);
  return (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
}

export function formatJourneyTime(journey: Pick<Journey, "modules">): string {
  const total = journey.modules.reduce((sum, m) => sum + parseMinutes(m.duration), 0);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeJourney(journey: Pick<Journey, "modules">): string {
  const labs = journey.modules.filter(hasLab).length;
  const quizzes = journey.modules.filter((m) => m.quiz).length;
  const parts = [plural(journey.modules.length, "module", "modules")];
  if (labs) parts.push(plural(labs, "lab", "labs"));
  if (quizzes) parts.push(plural(quizzes, "quiz", "quizzes"));
  parts.push(`about ${formatJourneyTime(journey)}`);
  return parts.join(" · ");
}

export function journeyTitle(journey: Pick<Journey, "title">): string {
  return journey.title.trim() || "Untitled journey";
}

export function moduleTitle(mod: Pick<JourneyModule, "title">): string {
  return mod.title.trim() || "Untitled module";
}

/** Structural equality that ignores key order (Postgres jsonb reorders keys). */
export function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameContent(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined);
  const ak = keys(ao);
  return ak.length === keys(bo).length && ak.every((k) => sameContent(ao[k], bo[k]));
}

type LooseBlock = { type?: unknown; children?: unknown; content?: unknown };

export function richDocHas(doc: RichDoc | undefined, type: string): boolean {
  const walk = (blocks: unknown): boolean =>
    Array.isArray(blocks) &&
    blocks.some((b: LooseBlock) => b?.type === type || walk(b?.children));
  return walk(doc);
}

export function richDocWordCount(doc: RichDoc | undefined): number {
  return countWords(doc ?? []);
}

/** True when a document has neither text nor any media/table block. */
export function richDocIsEmpty(doc: RichDoc | undefined): boolean {
  if (richDocWordCount(doc) > 0) return false;
  return !["image", "video", "file", "table", "divider", "codeBlock"].some((t) => richDocHas(doc, t));
}
