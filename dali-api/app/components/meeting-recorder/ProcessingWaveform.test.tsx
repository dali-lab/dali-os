// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProcessingWaveform, WAVEFORM_BARS, WAVEFORM_HEIGHTS, solidBarCount } from "./ProcessingWaveform";
import type { ProcessingStage } from "./types";

function render(stage: ProcessingStage, fraction: number) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(ProcessingWaveform, { stage, fraction }));
  return host;
}

const solid = (host: HTMLElement) => host.querySelectorAll('[data-solid="true"]').length;

describe("ProcessingWaveform", () => {
  it("renders 60 indexed bars with stable heights between 18% and 100%", () => {
    const host = render("starting", 0);
    const bars = host.querySelectorAll("[data-bar]");
    expect(bars).toHaveLength(WAVEFORM_BARS);
    expect(WAVEFORM_BARS).toBe(60);
    expect([...bars].map((b) => b.getAttribute("data-bar"))).toEqual(Array.from({ length: 60 }, (_, i) => String(i)));
    for (const h of WAVEFORM_HEIGHTS) {
      expect(h).toBeGreaterThanOrEqual(0.18);
      expect(h).toBeLessThanOrEqual(1);
    }
    expect(render("starting", 0).innerHTML).toBe(host.innerHTML);
  });

  it("starting and fetching have no solid bars", () => {
    expect(solid(render("starting", 0))).toBe(0);
    expect(solid(render("fetching", 0.9))).toBe(0);
  });

  it("transcribing: the leading bars up to the fraction are solid", () => {
    const host = render("transcribing", 0.5);
    expect(solid(host)).toBe(30);
    expect(host.querySelector('[data-bar="29"]')!.getAttribute("data-solid")).toBe("true");
    expect(host.querySelector('[data-bar="30"]')!.getAttribute("data-solid")).toBe("false");
  });

  it("transcribing: clamps the fraction", () => {
    expect(solidBarCount("transcribing", 2)).toBe(60);
    expect(solidBarCount("transcribing", -1)).toBe(0);
  });

  it("labeling: every bar is solid and the sweep rides the fraction", () => {
    const host = render("labeling", 0.25);
    expect(solid(host)).toBe(60);
    const sweep = host.querySelector("[data-sweep]") as HTMLElement;
    expect(sweep).not.toBeNull();
    expect(sweep.getAttribute("style")).toContain("25%");
  });

  it("the sweep only exists while labeling", () => {
    for (const stage of ["starting", "fetching", "transcribing"] as const) {
      expect(render(stage, 0.5).querySelector("[data-sweep]")).toBeNull();
    }
  });
});
