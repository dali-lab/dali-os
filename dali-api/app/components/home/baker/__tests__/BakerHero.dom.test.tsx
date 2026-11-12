// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import BakerHero from "../BakerHero";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

async function mount(iso: string) {
  vi.setSystemTime(new Date(iso));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(BakerHero, { now: Date.now(), greeting: "Good afternoon, Ada", detail: "Week 8 of 26F" }));
  });
  return host;
}

const art = (el: HTMLElement) => el.querySelector("image")!.getAttribute("href")!;
const rotations = (el: HTMLElement) =>
  [...el.querySelectorAll(".baker-hands line")].map((l) => l.getAttribute("transform"));

describe("BakerHero", () => {
  it("shows the season's day art with Hanover's time on the clock and in the overline", async () => {
    const el = await mount("2026-11-11T21:10:00Z");
    expect(art(el)).toContain("fall-day");
    expect(el.querySelector(".baker-hero")!.hasAttribute("data-night")).toBe(false);
    expect(rotations(el)).toEqual(["rotate(125)", "rotate(60)", "rotate(125)", "rotate(60)"]);
    expect(el.textContent).toContain("Hanover · Wednesday 4:10 PM");
    expect(el.textContent).toContain("Good afternoon, Ada");
    expect(el.textContent).toContain("Week 8 of 26F");
  });

  it("moves to the night art and the new time as the clock runs", async () => {
    const el = await mount("2026-11-11T21:10:00Z");
    await act(async () => {
      vi.setSystemTime(new Date("2026-11-11T23:30:00Z"));
      vi.advanceTimersByTime(30_000);
    });
    expect(art(el)).toContain("fall-night");
    expect(el.querySelector(".baker-hero")!.hasAttribute("data-night")).toBe(true);
    expect(el.textContent).toContain("6:30 PM");
  });

  it("has art for every season by day and night", async () => {
    for (const [iso, file] of [
      ["2026-01-15T17:00:00Z", "winter-day"],
      ["2026-01-15T03:00:00Z", "winter-night"],
      ["2026-05-01T16:00:00Z", "spring-day"],
      ["2026-05-01T04:00:00Z", "spring-night"],
      ["2026-07-15T16:00:00Z", "summer-day"],
      ["2026-07-15T05:00:00Z", "summer-night"],
    ]) {
      const el = await mount(iso);
      expect(art(el)).toMatch(new RegExp(`${file}\\.svg`));
      act(() => root?.unmount());
      el.remove();
    }
    root = null;
  });
});
