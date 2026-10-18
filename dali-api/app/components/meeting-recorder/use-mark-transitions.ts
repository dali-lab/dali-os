import { useEffect, useRef } from "react";
import { animate, DUR, prefersReducedMotion } from "./motion";
import { findBlock } from "./block-dom";
import { classifyEnhanceMark, firstLineOf, priorBlockFirstLine, type EnhanceMarkEntry } from "./enhance-plan";

export const ANIM_ATTR = "data-enhance-anim";
export const DELAY_VAR = "--enhance-delay";

export type TransitionKind = "bloom" | "drain" | "revert";
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
  const timers = useRef(new Map<HTMLElement, ReturnType<typeof setTimeout>>());
  const key = marks.map((m) => `${m.id}:${m.mark}`).join("|");

  function release(el: HTMLElement) {
    clearTimeout(timers.current.get(el));
    timers.current.delete(el);
    el.removeAttribute(ANIM_ATTR);
    el.style.removeProperty(DELAY_VAR);
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
    const reduced = prefersReducedMotion();

    for (const kind of ["bloom", "drain", "revert"] as const) {
      const group = inDocumentOrder(
        plan
          .filter((t) => t.kind === kind)
          .map((t) => ({ el: findBlock(root, t.id)!, t })),
      );
      group.forEach(({ el, t }, i) => {
        const delay = reduced ? 0 : i * STAGGER[kind];
        release(el);
        el.setAttribute(ANIM_ATTR, kind);
        el.style.setProperty(DELAY_VAR, `${delay}ms`);
        timers.current.set(
          el,
          setTimeout(() => release(el), delay + TOTAL[kind] + SETTLE_MS),
        );
        if (kind !== "bloom") return;
        if (t.added) growIn(el, delay);
        else riseIn(el.querySelector(".bn-inline-content"), delay);
      });
    }
  }, [key]);

  useEffect(
    () => () => {
      for (const el of [...timers.current.keys()]) release(el);
    },
    [],
  );
}
