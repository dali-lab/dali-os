import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRealtimeBusForTests, publish } from "~/lib/realtime-bus.server";
import {
  busEventStream,
  DEFAULT_SYNC_INTERVAL_MS,
  KEEPALIVE_INTERVAL_MS,
} from "~/lib/sse.server";

const decoder = new TextDecoder();

function open(headers: Record<string, string> = {}, topics = ["t:1"], opts?: { syncMs?: number }) {
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
    await new Promise((r) => setTimeout(r, 0));
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
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const s = open();
    await s.read();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    expect(await s.read()).toBe(": keepalive\n\n");
    vi.advanceTimersByTime(DEFAULT_SYNC_INTERVAL_MS - KEEPALIVE_INTERVAL_MS);
    expect(await s.read()).toContain("event: sync\ndata: 1\n\n");
    s.abort();
  });

  it("uses a caller's shorter sync interval", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const s = open({}, ["t:1"], { syncMs: 10_000 });
    await s.read();
    vi.advanceTimersByTime(10_000);
    expect(await s.read()).toBe("event: sync\ndata: 1\n\n");
    s.abort();
  });

  it("stops listening once the client disconnects", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const s = open();
    await s.read();
    s.abort();
    publish("t:1");
    vi.advanceTimersByTime(DEFAULT_SYNC_INTERVAL_MS);
    expect(await s.read()).toBe("");
    expect(s.isDone()).toBe(true);
  });

  it("tears down when the reader cancels", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const s = open();
    await s.read();
    await s.reader.cancel();
    expect(() => publish("t:1")).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
