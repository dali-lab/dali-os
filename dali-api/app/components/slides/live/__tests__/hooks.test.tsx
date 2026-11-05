// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFollowDeck } from "../useFollowDeck";
import { usePresenterSession } from "../usePresenterSession";
import type { LiveState } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeEventSource {
  static all: FakeEventSource[] = [];
  listeners = new Map<string, () => void>();
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(name: string, fn: () => void) {
    this.listeners.set(name, fn);
  }
  close() {}
  emit(name = "change") {
    this.listeners.get(name)?.();
  }
}

const inactive: LiveState = { active: false, slideId: null, build: 0, presenter: null, startedAt: null };
const active = (slideId: string): LiveState => ({
  active: true,
  slideId,
  build: 0,
  presenter: { id: "u1", name: "Ada" },
  startedAt: "2026-11-05T12:00:00.000Z",
});

let server: LiveState;
let fetchMock: ReturnType<typeof vi.fn>;
let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useFollowDeck> & ReturnType<typeof usePresenterSession>;

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function Probe({ kind }: { kind: "follow" | "present" }) {
  latest = (kind === "follow" ? useFollowDeck("p1") : usePresenterSession("p1")) as typeof latest;
  return null;
}

async function mount(kind: "follow" | "present") {
  await act(async () => root.render(createElement(Probe, { kind })));
  await flush();
}

beforeEach(() => {
  FakeEventSource.all = [];
  server = inactive;
  vi.stubGlobal("EventSource", FakeEventSource);
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      if (body.intent === "start" || body.intent === "go") server = active(body.slideId);
      if (body.intent === "end") server = inactive;
    }
    return new Response(JSON.stringify(server), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("useFollowDeck", () => {
  it("subscribes to the stream and refetches on a change event", async () => {
    await mount("follow");
    expect(FakeEventSource.all.map((s) => s.url)).toEqual(["/api/slides/p1/live/stream"]);
    expect(latest.active).toBe(false);

    server = active("s2");
    await act(async () => FakeEventSource.all[0].emit("change"));
    await flush();
    expect(latest).toMatchObject({ active: true, slideId: "s2", following: true, presenter: { id: "u1", name: "Ada" } });
  });

  it("stops following on browse, follows again, and re-follows a new presentation", async () => {
    server = active("s1");
    await mount("follow");
    act(() => latest.browseOnMyOwn());
    expect(latest.following).toBe(false);
    expect(latest.active).toBe(true);

    act(() => latest.follow());
    expect(latest.following).toBe(true);

    act(() => latest.browseOnMyOwn());
    server = inactive;
    await act(async () => FakeEventSource.all[0].emit("sync"));
    await flush();
    server = active("s1");
    await act(async () => FakeEventSource.all[0].emit("change"));
    await flush();
    expect(latest.following).toBe(true);
  });
});

describe("usePresenterSession", () => {
  const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));

  it("starts, moves optimistically, and ends", async () => {
    await mount("present");
    await act(async () => latest.start("s1"));
    expect(posts()).toEqual([{ intent: "start", slideId: "s1", build: 0 }]);
    expect(latest.live.active).toBe(true);

    let pending!: Promise<unknown>;
    act(() => {
      pending = latest.go("s3", 1);
    });
    expect(latest.live).toMatchObject({ slideId: "s3", build: 1 });
    await act(async () => pending);
    expect(posts()[1]).toEqual({ intent: "go", slideId: "s3", build: 1 });

    await act(async () => latest.end());
    expect(latest.live.active).toBe(false);
    expect(posts()[2]).toEqual({ intent: "end" });
  });

  it("falls back to the server state when a write is rejected", async () => {
    server = active("s1");
    await mount("present");
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === "POST" ? new Response("{}", { status: 403 }) : new Response(JSON.stringify(server), { status: 200 }),
    );
    await act(async () => latest.go("s5"));
    await flush();
    expect(latest.live.slideId).toBe("s1");
  });

  it("works without BroadcastChannel and syncs a second tab when present", async () => {
    server = active("s1");
    await mount("present");
    expect(latest.live.slideId).toBe("s1");

    const sent: unknown[] = [];
    let instance!: { onmessage: ((e: MessageEvent) => void) | null };
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage: ((e: MessageEvent) => void) | null = null;
        constructor(public name: string) {
          instance = this;
        }
        postMessage(m: unknown) {
          sent.push(m);
        }
        close() {}
      },
    );
    act(() => root.render(createElement(Probe, { kind: "present", key: "again" } as never)));
    await flush();
    await act(async () => instance.onmessage?.({ data: { slideId: "s4", build: 0 } } as MessageEvent));
    expect(latest.live.slideId).toBe("s4");
    await act(async () => latest.go("s6"));
    expect(sent).toContainEqual({ slideId: "s6", build: 0 });
  });
});
