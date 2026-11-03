import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaliThreadStore } from "../DaliThreadStore";

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, () => void>();
  close = vi.fn();
  readyState = 1;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
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

  it("falls back to polling once the stream closes for good, and stops on unsubscribe", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const store = new DaliThreadStore(config);
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const initial = fetchMock.mock.calls.length;
    const es = FakeEventSource.instances[0];
    es.readyState = FakeEventSource.CLOSED;
    es.onerror!();
    es.onerror!();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(initial + 1);
    unsub();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls.length).toBe(initial + 1);
  });

  it("does not poll while the stream is only reconnecting", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const store = new DaliThreadStore(config);
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const initial = fetchMock.mock.calls.length;
    const es = FakeEventSource.instances[0];
    es.readyState = 0;
    es.onerror!();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls.length).toBe(initial);
    unsub();
  });

  const closeLatestStream = () => {
    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    es.readyState = FakeEventSource.CLOSED;
    es.onerror!();
  };

  it("reopens a closed stream, then stops polling and catches up", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const store = new DaliThreadStore(config);
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    closeLatestStream();
    expect(FakeEventSource.instances[0].close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    const beforeOpen = fetchMock.mock.calls.length;
    FakeEventSource.instances[1].onopen!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.length).toBe(beforeOpen + 1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock.mock.calls.length).toBe(beforeOpen + 1);
    unsub();
  });

  it("does not refetch when the first stream opens", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const store = new DaliThreadStore(config);
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const initial = fetchMock.mock.calls.length;
    FakeEventSource.instances[0].onopen!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.length).toBe(initial);
    unsub();
  });

  it("backs off between failed reopens, up to five minutes", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.spyOn(Math, "random").mockReturnValue(1);
    const store = new DaliThreadStore(config);
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    for (const waitMs of [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]) {
      const opened = FakeEventSource.instances.length;
      closeLatestStream();
      await vi.advanceTimersByTimeAsync(waitMs - 100);
      expect(FakeEventSource.instances).toHaveLength(opened);
      await vi.advanceTimersByTimeAsync(100);
      expect(FakeEventSource.instances).toHaveLength(opened + 1);
    }
    unsub();
    vi.restoreAllMocks();
  });

  it("cancels a pending reopen on unsubscribe", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const store = new DaliThreadStore(config);
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    closeLatestStream();
    unsub();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("does not poll when pollIntervalMs is 0, but still reopens", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const store = new DaliThreadStore({ ...config, pollIntervalMs: 0 });
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const initial = fetchMock.mock.calls.length;
    closeLatestStream();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls.length).toBe(initial);
    expect(FakeEventSource.instances).toHaveLength(2);
    unsub();
  });

  it("keeps an explicit poll running after the stream reopens", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const store = new DaliThreadStore({ ...config, pollIntervalMs: 20_000 });
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    closeLatestStream();
    await vi.advanceTimersByTimeAsync(5_000);
    FakeEventSource.instances[1].onopen!();
    await vi.advanceTimersByTimeAsync(0);
    const afterOpen = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock.mock.calls.length).toBe(afterOpen + 1);
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
