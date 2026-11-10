import { BUILD_ANIM_MS, enteringAt, type BuildEffect } from "./builds";
import type { RenderSlide } from "./snapshot";

const SAFE_ID = /^[\w-]+$/;

const KEYFRAMES: Record<Exclude<BuildEffect, "appear">, string> = {
  fade: "@keyframes slide-build-fade{from{opacity:0}}",
  rise: "@keyframes slide-build-rise{from{opacity:0;translate:0 calc(var(--slide-u) * 40)}}",
  scale: "@keyframes slide-build-scale{from{opacity:0;scale:.9}}",
};

const LAST_BULLET = (target: string) => `${target}>div>:last-child:not(ul):not(ol),${target}>div>:is(ul,ol):last-child>li:last-child`;

/** The CSS that plays entrance effects for what appears at `step`. Empty when nothing animates. Motion is skipped for people who ask for less of it. */
export function buildEnterCss(slide: RenderSlide, step: number): string {
  const used = new Set<Exclude<BuildEffect, "appear">>();
  const rules: string[] = [];
  for (const e of enteringAt(slide, step)) {
    if (e.effect === "appear") continue;
    const key = e.slot ?? e.id;
    if (!SAFE_ID.test(key)) continue;
    const target = e.slot ? `[data-slot="${key}"]` : `[data-element="${key}"]`;
    used.add(e.effect);
    rules.push(`${e.bullet ? LAST_BULLET(target) : target}{animation:slide-build-${e.effect} ${BUILD_ANIM_MS}ms ease-out both}`);
  }
  if (rules.length === 0) return "";
  return `@media (prefers-reduced-motion:no-preference){${[...used].map((k) => KEYFRAMES[k]).join("")}${rules.join("")}}`;
}
