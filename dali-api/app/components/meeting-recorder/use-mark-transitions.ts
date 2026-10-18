import { useEffect, useRef, useState } from "react";
import { animate, DUR, prefersReducedMotion } from "./motion";
import { findBlock } from "./block-dom";
import { useBlockStyleRules } from "./block-style-rules";
import { markMotionCss, otherVariant, type MarkMotion, type TransitionKind } from "./enhance-rules";
import { classifyEnhanceMark, firstLineOf, priorBlockFirstLine, type EnhanceMarkEntry } from "./enhance-plan";

export type { TransitionKind };
export type MarkTransition = { id: string; kind: TransitionKind; added: boolean };

type PlanInput = {
  prev: readonly EnhanceMarkEntry[];
  next: readonly EnhanceMarkEntry[];
  priorBlocks: Record<string, unknown> | undefined;
  blockExists: (id: string) => boolean;
  blockText: (id: string) => string;
};

export function planMarkTransitions({ prev, next, priorBlocks, blockExists, blockText }: PlanInput): MarkTransition[] {
  const prevIds = new Set(prev.map((m) => m.id));
  const nextIds = new Set(next.map((m) => m.id));
  const plan: MarkTransition[] = [];

  for (const m of next) {
    if (prevIds.has(m.id) || !blockExists(m.id)) continue;
    plan.push({ id: m.id, kind: "bloom", added: classifyEnhanceMark(m, priorBlocks) === "Added" });
  }

  for (const m of prev) {
    if (nextIds.has(m.id) || !blockExists(m.id)) continue;
    const prior = classifyEnhanceMark(m, priorBlocks) === "Changed" ? priorBlockFirstLine(priorBlocks?.[m.id]) : null;
    const restored = prior !== null && firstLineOf(blockText(m.id)).trim() === prior.trim();
    plan.push({ id: m.id, kind: restored ? "revert" : "drain", added: false });
  }

  return plan;
}

const STAGGER: Record<TransitionKind, number> = {
  bloom: DUR.bloomStagger,
  drain: DUR.drainStagger,
  revert: DUR.drainStagger,
};

const TOTAL: Record<TransitionKind, number> = {
  bloom: DUR.bloomTint,
  drain: DUR.drainTint + DUR.drainEdge,
  revert: DUR.revertFade,
};

const SETTLE_MS = 60;

function inDocumentOrder(entries: { el: HTMLElement; t: MarkTransition }[]) {
  return entries.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

function riseIn(el: Element | null, delay: number) {
  void animate(
    el,
    [
      { opacity: 0, transform: `translateY(${DUR.bloomTextRisePx}px)` },
      { opacity: 1, transform: "none" },
    ],
    DUR.bloomText,
    { delay },
  );
}

function growIn(el: HTMLElement, delay: number) {
  const height = el.offsetHeight;
  void animate(
    el,
    [
      { height: "0px", opacity: 0, overflow: "hidden" },
      { height: `${height}px`, opacity: 1, overflow: "hidden" },
    ],
    DUR.bloomText,
    { delay },
  );
}

export function useMarkTransitions({
  marks,
  priorBlocks,
  getRoot,
}: {
  marks: readonly EnhanceMarkEntry[];
  priorBlocks: Record<string, unknown> | undefined;
  getRoot: () => HTMLElement | null;
}) {
  const previous = useRef<readonly EnhanceMarkEntry[] | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [motions, setMotions] = useState<Record<string, MarkMotion>>({});
  const key = marks.map((m) => `${m.id}:${m.mark}`).join("|");

  useBlockStyleRules("anim", markMotionCss(Object.values(motions)));

  function release(id: string) {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setMotions((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _gone, ...rest } = prev;
      return rest;
    });
  }

  useEffect(() => {
    const prev = previous.current;
    previous.current = marks;
    const root = getRoot();
    if (prev === null || !root) return;

    const plan = planMarkTransitions({
      prev,
      next: marks,
      priorBlocks,
      blockExists: (id) => findBlock(root, id) !== null,
      blockText: (id) => findBlock(root, id)?.querySelector(".bn-inline-content")?.textContent ?? "",
    });
    if (plan.length === 0) return;
    const reduced = prefersReducedMotion();

    const started: MarkMotion[] = [];
    for (const kind of ["bloom", "drain", "revert"] as const) {
      const group = inDocumentOrder(
        plan
          .filter((t) => t.kind === kind)
          .map((t) => ({ el: findBlock(root, t.id)!, t })),
      );
      group.forEach(({ el, t }, i) => {
        const delay = reduced ? 0 : i * STAGGER[kind];
        started.push({ id: t.id, kind, delay, variant: "a" });
        clearTimeout(timers.current.get(t.id));
        timers.current.set(
          t.id,
          setTimeout(() => release(t.id), delay + TOTAL[kind] + SETTLE_MS),
        );
        if (kind !== "bloom") return;
        if (t.added) growIn(el, delay);
        else riseIn(el.querySelector(".bn-inline-content"), delay);
      });
    }
    setMotions((current) => {
      const next = { ...current };
      for (const m of started) next[m.id] = { ...m, variant: current[m.id] ? otherVariant(current[m.id]!.variant) : "a" };
      return next;
    });
  }, [key]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );
}
