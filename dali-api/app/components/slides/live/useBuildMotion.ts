import { useEffect, useRef } from "react";
import { BUILD_ANIM_MS, type DeckPosition } from "~/components/slides/deck/builds";

/** The step to animate: set only when this render moved forward by one step within the same slide. */
export function useEnterStep(index: number, step: number): number | undefined {
  const prev = useRef<DeckPosition>({ index, step });
  const enter = prev.current.index === index && step === prev.current.step + 1 ? step : undefined;
  useEffect(() => {
    prev.current = { index, step };
  });
  return enter;
}

interface AutoBuilds {
  index: number;
  step: number;
  enabled: boolean;
  autoDelayOf: (index: number, step: number) => number | null;
  advance: (to: DeckPosition) => void;
}

/** Plays steps marked "after previous" by moving the presenter on once the delay passes. Moving backward never replays them. */
export function useAutoBuilds({ index, step, enabled, autoDelayOf, advance }: AutoBuilds): void {
  const prev = useRef<DeckPosition | null>(null);
  const held = useRef(false);
  const last = prev.current;
  if (!last || last.index !== index || last.step !== step) {
    if (last) held.current = index < last.index || (index === last.index && step < last.step);
    prev.current = { index, step };
  }
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const delay = enabled && !held.current ? autoDelayOf(index, step + 1) : null;
  useEffect(() => {
    if (delay === null) return;
    const timer = setTimeout(() => advanceRef.current({ index, step: step + 1 }), BUILD_ANIM_MS + delay);
    return () => clearTimeout(timer);
  }, [index, step, delay]);
}
