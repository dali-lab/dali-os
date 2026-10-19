// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { animate, EASE, reduceFrames, REDUCED_MAX_MS } from "./motion";

function fakeAnimate() {
  return vi.fn((..._args: unknown[]) => ({ onfinish: null as null | (() => void), oncancel: null as null | (() => void), cancel: vi.fn() }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
});

function reduced(on: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("reduce") }));
}

describe("motion", () => {
  it("resolves immediately and does not throw without the Web Animations API", async () => {
    const el = document.createElement("div");
    await expect(animate(el, [{ opacity: 0 }, { opacity: 1 }], 200)).resolves.toBeUndefined();
    await expect(animate(null, [{ opacity: 0 }], 200)).resolves.toBeUndefined();
  });

  it("passes the shared easing, duration and delay through", () => {
    reduced(false);
    const spy = fakeAnimate();
    (Element.prototype as { animate?: unknown }).animate = spy;
    animate(document.createElement("div"), [{ opacity: 0 }, { opacity: 1 }], 260, { delay: 90 });
    expect(spy.mock.calls[0]![1] as object).toMatchObject({ duration: 260, delay: 90, easing: EASE });
  });

  it("under reduced motion keeps only opacity, caps at 120ms and drops delay", () => {
    reduced(true);
    const spy = fakeAnimate();
    (Element.prototype as { animate?: unknown }).animate = spy;
    animate(document.createElement("div"), [{ opacity: 0, transform: "scale(.9)" }, { opacity: 1, transform: "none" }], 360, { delay: 90 });
    const [frames, opts] = spy.mock.calls[0]! as [Keyframe[], KeyframeAnimationOptions];
    expect(frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(opts.duration).toBeLessThanOrEqual(REDUCED_MAX_MS);
    expect(opts.delay).toBe(0);
  });

  it("falls back to a fade-in when frames carry no opacity", () => {
    expect(reduceFrames([{ height: "0px" }, { height: "10px" }])).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });
});
