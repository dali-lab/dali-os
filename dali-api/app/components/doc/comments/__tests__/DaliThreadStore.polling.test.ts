import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaliThreadStore } from "../DaliThreadStore";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, () => void>();
  close = vi.fn();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, cb: () => void) {
    this.listeners.set(name, cb);
  }
}

const config = { pageId: "p1", canComment: true, canModerate: false, currentUserId: "u1" };

describe("DaliThreadStore refresh path", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ comments: [] })));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not poll by default when EventSource exists", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const store = new DaliThreadStore(config);
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const initial = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock.mock.calls.length).toBe(initial);
    unsub();
  });

  it("refetches on SSE change and sync", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const store = new DaliThreadStore(config);
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const initial = fetchMock.mock.calls.length;
    const es = FakeEventSource.instances[0];
    es.listeners.get("change")!();
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock.mock.calls.length).toBe(initial + 1);
    es.listeners.get("sync")!();
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock.mock.calls.length).toBe(initial + 2);
    unsub();
  });

  it("polls every 30s as the fallback when EventSource is unavailable", async () => {
    vi.stubGlobal("EventSource", undefined);
    const store = new DaliThreadStore(config);
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const initial = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(initial + 1);
    unsub();
  });

  it("honors an explicit pollIntervalMs even with EventSource", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const store = new DaliThreadStore({ ...config, pollIntervalMs: 5_000 });
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const initial = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock.mock.calls.length).toBe(initial + 1);
    unsub();
  });
});
