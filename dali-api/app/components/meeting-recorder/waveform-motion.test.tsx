// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mountDom } from "./test-support";
import { ProcessingWaveform } from "./ProcessingWaveform";

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

  it("defines the keyframes the hooks and bar rely on", () => {
    for (const name of ["enhance-tint-in", "enhance-tint-out", "enhance-edge-in", "enhance-edge-out", "enhance-wash", "enhance-wave-breathe", "enhance-dot-pulse"]) {
      expect(css).toContain(`@keyframes ${name}`);
    }
  });

  it("keeps the CSS durations in step with the shared timing table", () => {
    expect(css).toMatch(/data-enhance-anim="bloom"\] > \.bn-block::before \{\s*animation-name: enhance-tint-in;\s*animation-duration: 360ms/);
    expect(css).toMatch(/data-enhance-anim="drain"\] > \.bn-block::before \{\s*animation-name: enhance-tint-out;\s*animation-duration: 240ms/);
  });

  it("stops loops and shortens transitions under reduced motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/animation-duration: 120ms/);
  });
});
