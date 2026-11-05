import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRealtimeBusForTests, publish } from "~/lib/realtime-bus.server";
import {
  busEventStream,
  DEFAULT_SYNC_INTERVAL_MS,
  KEEPALIVE_INTERVAL_MS,
} from "~/lib/sse.server";

const decoder = new TextDecoder();

function open(headers: Record<string, string> = {}, topics = ["t:1"], opts?: { syncMs?: number; carryData?: boolean }) {
  const controller = new AbortController();
  const request = new Request("http://test/stream", { headers, signal: controller.signal });
  const res = busEventStream(request, topics, opts);
  const reader = res.body!.getReader();
  let buffered = "";
  let done = false;
  void (async () => {
    for (;;) {
      const next = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (next.done) {
        done = true;
        return;
      }
      buffered += decoder.decode(next.value);
    }
  })();
  // Everything the stream has enqueued so far.
  const read = async () => {
    await new Promise((r) => setImmediate(r));
    const out = buffered;
    buffered = "";
    return out;
  };
  return { res, read, abort: () => controller.abort(), reader, isDone: () => done };
}

beforeEach(() => {
  vi.stubEnv("REDIS_URL", "");
  __resetRealtimeBusForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  __resetRealtimeBusForTests();
});

describe("busEventStream", () => {
  it("returns an uncached event-stream response", () => {
    const { res, abort } = open();
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    abort();
  });

  it("opens with a comment and an id so a reconnect carries Last-Event-ID", async () => {
    const s = open();
    expect(await s.read()).toBe(": connected\nid: 1\n\n");
    s.abort();
  });

  it("sends change when a subscribed topic is published", async () => {
    const s = open();
    await s.read();
    publish("t:1");
    expect(await s.read()).toBe("event: change\ndata: 1\n\n");
    s.abort();
  });

  it("listens to every topic it was given, once each", async () => {
    const s = open({}, ["a", "b", "a"]);
    await s.read();
    publish("a");
    publish("b");
    expect(await s.read()).toBe("event: change\ndata: 1\n\n".repeat(2));
    s.abort();
  });

  it("ignores topics it wasn't given", async () => {
    const s = open();
    await s.read();
    publish("t:2");
    expect(await s.read()).toBe("");
    s.abort();
  });

  it("sends an immediate sync to a reconnecting client", async () => {
    const s = open({ "Last-Event-ID": "1" });
    expect(await s.read()).toBe(": connected\nid: 1\n\nevent: sync\ndata: 1\n\n");
    s.abort();
  });

  it("does not sync immediately on a first connect", async () => {
    const s = open();
    expect(await s.read()).not.toContain("event: sync");
    s.abort();
  });

  it("sends keepalives and a sync on the default interval", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const s = open();
    await s.read();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    expect(await s.read()).toBe(": keepalive\n\n");
    vi.advanceTimersByTime(DEFAULT_SYNC_INTERVAL_MS - KEEPALIVE_INTERVAL_MS);
    expect(await s.read()).toContain("event: sync\ndata: 1\n\n");
    s.abort();
  });

  it("uses a caller's shorter sync interval", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const s = open({}, ["t:1"], { syncMs: 10_000 });
    await s.read();
    vi.advanceTimersByTime(10_000);
    expect(await s.read()).toBe("event: sync\ndata: 1\n\n");
    s.abort();
  });

  it("starts each connection's sync at its own point in the interval", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
    const early = open({}, ["t:1"], { syncMs: 10_000 });
    await early.read();
    random.mockReturnValue(0.75);
    const late = open({}, ["t:1"], { syncMs: 10_000 });
    await late.read();
    vi.advanceTimersByTime(2_500);
    expect(await early.read()).toBe("event: sync\ndata: 1\n\n");
    vi.advanceTimersByTime(5_000);
    expect(await late.read()).toBe("event: sync\ndata: 1\n\n");
    early.abort();
    late.abort();
  });

  it("keeps syncing every interval after the first", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const s = open({}, ["t:1"], { syncMs: 4_000 });
    await s.read();
    vi.advanceTimersByTime(2_000);
    await s.read();
    vi.advanceTimersByTime(4_000);
    expect(await s.read()).toBe("event: sync\ndata: 1\n\n");
    vi.advanceTimersByTime(4_000);
    expect(await s.read()).toBe("event: sync\ndata: 1\n\n");
    s.abort();
  });

  it("cancels a first sync that hasn't fired when the client leaves", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const s = open({}, ["t:1"], { syncMs: 10_000 });
    await s.read();
    s.abort();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops listening once the client disconnects", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const s = open();
    await s.read();
    s.abort();
    publish("t:1");
    vi.advanceTimersByTime(DEFAULT_SYNC_INTERVAL_MS);
    expect(await s.read()).toBe("");
    expect(s.isDone()).toBe(true);
  });

  it("tears down when the reader cancels", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const s = open();
    await s.read();
    await s.reader.cancel();
    expect(() => publish("t:1")).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("busEventStream carryData", () => {
  it("sends the publisher's payload when asked, on one line", async () => {
    const stream = open({}, ["t:1"], { carryData: true });
    await stream.read();
    publish("t:1", '{"emoji":"x"}\nsecond');
    const out = await stream.read();
    expect(out).toContain('event: change\ndata: {"emoji":"x"} second\n\n');
    stream.abort();
  });

  it("stays payload-less by default", async () => {
    const stream = open();
    await stream.read();
    publish("t:1", "secret");
    const out = await stream.read();
    expect(out).toContain("event: change\ndata: 1\n\n");
    expect(out).not.toContain("secret");
    stream.abort();
  });
});
