// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mountDom } from "./test-support";
import { ProcessingWaveform } from "./ProcessingWaveform";
import { markMotionCss } from "./enhance-rules";
import { DUR } from "./motion";

afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  document.body.innerHTML = "";
});

function spyAnimate() {
  const animated: string[] = [];
  (Element.prototype as { animate?: unknown }).animate = function (this: Element) {
    animated.push(this.getAttribute("data-bar") ?? "?");
    return { onfinish: null, oncancel: null, cancel() {} };
  };
  return animated;
}

describe("waveform animation", () => {
  it("animates only the bars that newly turned solid when the fraction rises", () => {
    const animated = spyAnimate();
    const ui = mountDom(createElement(ProcessingWaveform, { stage: "transcribing", fraction: 0.5 }));
    expect(animated).toEqual([]);
    ui.rerender(createElement(ProcessingWaveform, { stage: "transcribing", fraction: 0.55 }));
    expect(animated).toEqual(["30", "31", "32"]);
    ui.rerender(createElement(ProcessingWaveform, { stage: "transcribing", fraction: 0.55 }));
    expect(animated).toHaveLength(3);
    ui.unmount();
  });

  it("animates every bar once when mounted as ready", () => {
    const animated = spyAnimate();
    const ui = mountDom(createElement(ProcessingWaveform, { stage: "ready", fraction: 1 }));
    expect(animated).toHaveLength(60);
    ui.unmount();
  });
});

describe("theme.css motion", () => {
  const css = readFileSync(join(process.cwd(), "app/components/doc/theme.css"), "utf8");

  it("defines every keyframe the generated rules and the bar rely on, with a twin for restarts", () => {
    for (const base of ["enhance-tint-in", "enhance-tint-out", "enhance-edge-in", "enhance-edge-out", "enhance-fade-out", "enhance-wash"]) {
      for (const variant of ["a", "b"]) expect(css).toContain(`@keyframes ${base}-${variant}`);
    }
    for (const name of ["enhance-wave-breathe", "enhance-dot-pulse"]) expect(css).toContain(`@keyframes ${name}`);
  });

  it("keeps the suggestion edge visible by clearing the content tint that would cover it", () => {
    const row = '.dali-doc .bn-block:has(> .bn-block-content[data-background-color="enhance-added"])';
    expect(css).toMatch(new RegExp(`${row.replace(/[.()[\]>=*"]/g, "\\$&")} \\{\\s*box-shadow: inset 3px 0 0 var\\(--enhance-edge\\);`));
    expect(css).toContain(`${row} > .bn-block-content[data-background-color="enhance-added"] {\n  background-color: transparent;`);
    expect(css).toContain("--enhance-edge: var(--color-accent-teal);");
  });

  it("holds no attribute selectors for state the editor would strip", () => {
    for (const attr of ["data-enhance-anim", "data-enhance-was", "data-enhance-wash", "data-action-chips"]) {
      expect(css).not.toContain(attr);
    }
  });

  it("keeps the generated rules' durations in step with the shared timing table", () => {
    const bloom = markMotionCss([{ id: "a", kind: "bloom", delay: 0, variant: "a" }]);
    expect(bloom).toContain(`enhance-tint-in-a ${DUR.bloomTint}ms`);
    expect(bloom).toContain(`enhance-edge-in-a ${DUR.bloomEdge}ms`);
    const drain = markMotionCss([{ id: "a", kind: "drain", delay: 70, variant: "b" }]);
    expect(drain).toContain(`enhance-tint-out-b ${DUR.drainTint}ms`);
    expect(drain).toContain(`enhance-edge-out-b ${DUR.drainEdge}ms`);
    expect(drain).toMatch(new RegExp(`enhance-edge-out-b ${DUR.drainEdge}ms [^;]* ${70 + DUR.drainTint}ms both`));
    expect(markMotionCss([{ id: "a", kind: "revert", delay: 0, variant: "a" }])).toContain(`enhance-fade-out-a ${DUR.revertFade}ms`);
  });

  it("stops loops and shortens transitions under reduced motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/animation-duration: 120ms/);
  });
});
