// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { DinoGame } = await import("~/components/dino/DinoGame");

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(DinoGame));
  });
  return host;
}

const entry = (rank: number, userId: string, name: string, score: number) => ({
  rank,
  userId,
  name,
  score,
  achievedAt: "2026-10-19T00:00:00Z",
});

function respond(status: number, body: unknown = {}) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DinoGame leaderboard", () => {
  it("asks the dino board endpoint for scores", async () => {
    const fetch = respond(200, { entries: [], you: null });
    vi.stubGlobal("fetch", fetch);
    await mount();
    expect(fetch.mock.calls[0][0]).toBe("/api/dino-scores");
  });

  it("shows the top places with names and scores", async () => {
    vi.stubGlobal(
      "fetch",
      respond(200, { entries: [entry(1, "a", "Ada Bates", 1200), entry(2, "b", "Bo Chen", 800)], you: null }),
    );
    const el = await mount();
    const rows = [...el.querySelectorAll("aside[aria-label='High scores'] li")].map((li) => li.textContent);
    expect(rows).toEqual(["1Ada Bates1,200", "2Bo Chen800"]);
  });

  it("caps the board at five places and trails the caller's own rank", async () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(i + 1, `u${i}`, `P${i}`, 1000 - i));
    vi.stubGlobal("fetch", respond(200, { entries, you: entry(14, "me", "Me", 50) }));
    const el = await mount();
    const rows = [...el.querySelectorAll("aside li")].map((li) => li.textContent);
    expect(rows).toHaveLength(6);
    expect(rows[5]).toBe("14You50");
  });

  it("labels the caller's row as You when they placed", async () => {
    const mine = entry(1, "me", "Me Myself", 900);
    vi.stubGlobal("fetch", respond(200, { entries: [mine], you: mine }));
    const el = await mount();
    expect(el.querySelector("aside li")?.textContent).toBe("1You900");
  });

  it("invites a first score on an empty board", async () => {
    vi.stubGlobal("fetch", respond(200, { entries: [], you: null }));
    const el = await mount();
    expect(el.querySelector("aside")?.textContent).toContain("No scores yet. Set the first one.");
  });

  it("hides the board from anyone the server turns away, and the game still renders", async () => {
    vi.stubGlobal("fetch", respond(403, { error: "Forbidden" }));
    const el = await mount();
    expect(el.querySelector("aside")).toBeNull();
    expect(el.querySelector("canvas")).not.toBeNull();
  });

  it("hides the board when the request fails outright", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const el = await mount();
    expect(el.querySelector("aside")).toBeNull();
    expect(el.querySelector("canvas")).not.toBeNull();
  });
});

describe("DinoGame score reporting", () => {
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames = [];
    const ctx = new Proxy({}, { get: () => () => {} });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  async function playUntilHit(el: HTMLElement) {
    await act(async () => {
      el.querySelector("canvas")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    // Never jumping, the runner meets the first block within a few seconds.
    let now = performance.now();
    for (let i = 0; i < 400 && !el.textContent?.includes("Hit."); i++) {
      now += 50;
      const next = frames.shift();
      await act(async () => next?.(now));
    }
    expect(el.textContent).toContain("Hit.");
  }

  const posts = (fetch: ReturnType<typeof vi.fn>) =>
    fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

  it("reports a finished run to the board", async () => {
    const fetch = respond(200, { entries: [], you: null, personalBest: true });
    vi.stubGlobal("fetch", fetch);
    const el = await mount();
    await playUntilHit(el);
    const [[url, init]] = posts(fetch);
    expect(url).toBe("/api/dino-scores");
    expect(JSON.parse((init as RequestInit).body as string).score).toBeGreaterThan(0);
    expect(el.textContent).toContain("new best");
  });

  it("doesn't report runs for someone the board turned away", async () => {
    const fetch = respond(403);
    vi.stubGlobal("fetch", fetch);
    const el = await mount();
    await playUntilHit(el);
    expect(posts(fetch)).toHaveLength(0);
  });
});
