import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

class FakeRedis extends EventEmitter {
  url: string;
  published: [string, string][] = [];
  subscribed: string[] = [];
  publishResult: Promise<number> = Promise.resolve(1);
  disconnected = false;
  constructor(url: string) {
    super();
    this.url = url;
    redisInstances.push(this);
  }
  publish(channel: string, message: string) {
    this.published.push([channel, message]);
    return this.publishResult;
  }
  subscribe(channel: string) {
    this.subscribed.push(channel);
    return Promise.resolve(1);
  }
  disconnect() {
    this.disconnected = true;
  }
}
const redisInstances: FakeRedis[] = [];

// The factory runs lazily on first import of ioredis, after this module's
// top level has run, so it can close over FakeRedis.
vi.mock("ioredis", () => ({
  default: class {
    constructor(url: string) {
      return new FakeRedis(url);
    }
  },
}));

import { __resetRealtimeBusForTests, publish, subscribe } from "~/lib/realtime-bus.server";

beforeEach(() => {
  __resetRealtimeBusForTests();
  redisInstances.length = 0;
  vi.unstubAllEnvs();
});

afterEach(() => {
  __resetRealtimeBusForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("in-process (no REDIS_URL)", () => {
  beforeEach(() => vi.stubEnv("REDIS_URL", ""));

  it("delivers a publish to the topic's subscribers as a change", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe("t:1", a);
    subscribe("t:1", b);
    publish("t:1");
    expect(a).toHaveBeenCalledWith("change", undefined);
    expect(b).toHaveBeenCalledWith("change", undefined);
  });

  it("passes a publish's payload to subscribers", () => {
    const fn = vi.fn();
    subscribe("t:1", fn);
    publish("t:1", "payload");
    expect(fn).toHaveBeenCalledWith("change", "payload");
  });

  it("does not deliver to other topics", () => {
    const other = vi.fn();
    subscribe("t:2", other);
    publish("t:1");
    expect(other).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe", () => {
    const fn = vi.fn();
    const off = subscribe("t:1", fn);
    off();
    publish("t:1");
    expect(fn).not.toHaveBeenCalled();
  });

  it("unsubscribe is safe to call twice", () => {
    const off = subscribe("t:1", vi.fn());
    off();
    expect(() => off()).not.toThrow();
  });

  it("a throwing subscriber does not block the rest", () => {
    const after = vi.fn();
    subscribe("t:1", () => {
      throw new Error("closed");
    });
    subscribe("t:1", after);
    publish("t:1");
    expect(after).toHaveBeenCalledOnce();
  });

  it("publishing a topic nobody holds is a no-op", () => {
    expect(() => publish("nobody")).not.toThrow();
  });

  it("opens no Redis connection", () => {
    subscribe("t:1", vi.fn());
    publish("t:1");
    expect(redisInstances).toHaveLength(0);
  });
});

describe("with REDIS_URL", () => {
  beforeEach(() => vi.stubEnv("REDIS_URL", "redis://fake:6379"));

  const pubConn = () => redisInstances[0];
  const subConn = () => redisInstances[1];

  it("opens one publisher and one subscriber, once", () => {
    subscribe("t:1", vi.fn());
    subscribe("t:2", vi.fn());
    publish("t:1");
    expect(redisInstances).toHaveLength(2);
    expect(redisInstances.every((r) => r.url === "redis://fake:6379")).toBe(true);
    expect(subConn().subscribed).toEqual(["dali:realtime"]);
  });

  it("publishes the topic with this process's origin on the shared channel", () => {
    publish("notify:u1");
    expect(pubConn().published).toHaveLength(1);
    const [channel, raw] = pubConn().published[0];
    expect(channel).toBe("dali:realtime");
    const msg = JSON.parse(raw);
    expect(msg.topic).toBe("notify:u1");
    expect(typeof msg.origin).toBe("string");
  });

  it("still delivers locally right away", () => {
    const fn = vi.fn();
    subscribe("t:1", fn);
    publish("t:1");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("delivers a message from another machine as a change", () => {
    const fn = vi.fn();
    subscribe("t:1", fn);
    subConn().emit("message", "dali:realtime", JSON.stringify({ topic: "t:1", origin: "other" }));
    expect(fn).toHaveBeenCalledWith("change", undefined);
  });

  it("carries the payload across machines", () => {
    publish("t:2", "p1");
    expect(JSON.parse(pubConn().published[0][1]).data).toBe("p1");
    const fn = vi.fn();
    subscribe("t:1", fn);
    subConn().emit("message", "dali:realtime", JSON.stringify({ topic: "t:1", origin: "other", data: "p2" }));
    expect(fn).toHaveBeenCalledWith("change", "p2");
  });

  it("drops a non-string payload from another machine", () => {
    const fn = vi.fn();
    subscribe("t:1", fn);
    subConn().emit("message", "dali:realtime", JSON.stringify({ topic: "t:1", origin: "other", data: 7 }));
    expect(fn).toHaveBeenCalledWith("change", undefined);
  });

  it("drops its own echo so local subscribers hear a publish once", () => {
    const fn = vi.fn();
    subscribe("t:1", fn);
    publish("t:1");
    const [, raw] = pubConn().published[0];
    subConn().emit("message", "dali:realtime", raw);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("ignores other channels, malformed payloads, and missing topics", () => {
    const fn = vi.fn();
    subscribe("t:1", fn);
    subConn().emit("message", "other", JSON.stringify({ topic: "t:1", origin: "x" }));
    subConn().emit("message", "dali:realtime", "{not json");
    subConn().emit("message", "dali:realtime", JSON.stringify({ origin: "x" }));
    subConn().emit("message", "dali:realtime", JSON.stringify({ topic: 5, origin: "x" }));
    expect(fn).not.toHaveBeenCalled();
  });

  it("sends every local subscriber a sync when the subscriber reconnects, not on first connect", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe("t:1", a);
    subscribe("t:2", b);
    subConn().emit("ready");
    expect(a).not.toHaveBeenCalled();
    subConn().emit("ready");
    expect(a).toHaveBeenCalledWith("sync", undefined);
    expect(b).toHaveBeenCalledWith("sync", undefined);
  });

  it("logs a failed publish instead of throwing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    subscribe("t:1", vi.fn());
    pubConn().publishResult = Promise.reject(new Error("down"));
    expect(() => publish("t:1")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(err).toHaveBeenCalledWith("[realtime-bus] publish failed", "down");
  });

  it("logs connection errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    subscribe("t:1", vi.fn());
    subConn().emit("error", new Error("ECONNRESET"));
    expect(err).toHaveBeenCalledWith("[realtime-bus] redis error", "ECONNRESET");
  });

  it("reset disconnects both connections", () => {
    subscribe("t:1", vi.fn());
    const conns = [...redisInstances];
    __resetRealtimeBusForTests();
    expect(conns.every((c) => c.disconnected)).toBe(true);
  });
});
