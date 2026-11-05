import "./transition.css";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { withPlacements } from "~/components/slides/deck/freeform";
import { effectiveTransition, planMorph, prefersReducedMotion, type MorphPlan, type TransitionKind } from "~/components/slides/deck/slide-meta";
import { SlideRender } from "~/components/slides/deck/SlideRender";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import type { RenderSlide as RenderSlideFn } from "./types";

interface Anim {
  from: RenderSlide;
  to: RenderSlide;
  kind: TransitionKind;
  duration: number;
  forward: boolean;
  plan: MorphPlan | null;
  go: boolean;
}

export interface SlideTransitionStageProps {
  slides: RenderSlide[];
  themeId: string;
  slideId: string;
  step?: number;
  width: number;
  renderSlide: RenderSlideFn;
}

const layer = (extra: CSSProperties): CSSProperties => ({ position: "absolute", inset: 0, ...extra });

/** Draws one slide, and plays the arriving slide's transition when the slide changes. Builds run after it, since only the slide change starts one. */
export function SlideTransitionStage({ slides, themeId, slideId, step, width, renderSlide }: SlideTransitionStageProps) {
  const last = useRef<string | null>(null);
  const [anim, setAnim] = useState<Anim | null>(null);

  useLayoutEffect(() => {
    const from = last.current;
    last.current = slideId;
    if (!from || from === slideId) return;
    const to = slides.find((s) => s.id === slideId);
    const before = slides.find((s) => s.id === from);
    const t = effectiveTransition(to?.transition, prefersReducedMotion());
    if (!to || !before || !t) return setAnim(null);
    setAnim({
      from: before,
      to,
      kind: t.kind,
      duration: t.duration ?? 0,
      forward: slides.indexOf(to) >= slides.indexOf(before),
      plan: t.kind === "magic" ? planMorph(before, to) : null,
      go: false,
    });
  }, [slideId, slides]);

  useEffect(() => {
    if (!anim) return;
    if (!anim.go) {
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setAnim((a) => (a ? { ...a, go: true } : a)));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    const done = setTimeout(() => setAnim(null), anim.duration + 50);
    return () => clearTimeout(done);
  }, [anim]);

  const live = anim && anim.to.id === slideId ? anim : null;
  if (!live) return <>{renderSlide(slideId, { width, step })}</>;
  const { from, to, kind, duration, go, forward, plan } = live;
  const ease = `${duration}ms ease`;
  const dir = forward ? 1 : -1;

  if (kind === "magic" && plan) {
    return (
      <div data-transition="magic" style={{ position: "relative", width: "100%", height: "100%", ["--morph-ms" as string]: `${duration}ms` }}>
        <SlideRender slide={withPlacements(to, [go ? undefined : plan.starts])} theme={themeId} step={step} hide={go ? undefined : plan.entering} morph />
        <div data-transition-layer="out" style={layer({ opacity: go ? 0 : 1, transition: `opacity ${ease}`, pointerEvents: "none" })}>
          <SlideRender slide={from} theme={themeId} transparent hide={plan.continuing} />
        </div>
      </div>
    );
  }

  const incoming = <div data-transition-layer="in" style={layer(kind === "push" ? { transform: go ? "none" : `translateX(${100 * dir}%)`, transition: `transform ${ease}` } : {})}>{renderSlide(to.id, { width, step })}</div>;
  const outgoing = (
    <div
      data-transition-layer="out"
      style={layer(kind === "push" ? { transform: go ? `translateX(${-100 * dir}%)` : "none", transition: `transform ${ease}` } : { opacity: go ? 0 : 1, transition: `opacity ${ease}`, pointerEvents: "none" })}
    >
      {renderSlide(from.id, { width })}
    </div>
  );
  return (
    <div data-transition={kind} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {incoming}
      {outgoing}
    </div>
  );
}
