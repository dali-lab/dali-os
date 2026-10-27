import { randomUUID } from "node:crypto";
import IORedis from "ioredis";

// Topic-keyed pub/sub behind every live surface (notification, comment,
// activity, staffing, and delibs streams). With REDIS_URL set, events fan out
// to every machine over one Redis channel, so a stream on machine B hears a
// publish from machine A. Without it (local dev, single-machine staging) the
// bus is in-process only, which is complete when there is one process.

export type BusEvent = "change" | "sync";
// `data` is the publisher's optional payload; a `sync` never carries one.
type Subscriber = (event: BusEvent, data?: string) => void;

const CHANNEL = "dali:realtime";

type BusState = {
  registry: Map<string, Set<Subscriber>>;
  origin: string;
  redis: { pub: IORedis; sub: IORedis } | null;
  redisUrl: string | undefined;
};

// On globalThis so Vite HMR re-evaluating this module keeps live subscribers
// and doesn't open a second pair of Redis connections.
const g = globalThis as unknown as { __realtimeBus?: BusState };
const state: BusState = (g.__realtimeBus ??= {
  registry: new Map(),
  origin: randomUUID(),
  redis: null,
  redisUrl: undefined,
});

function deliver(topic: string, event: BusEvent, data?: string): void {
  const set = state.registry.get(topic);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event, data);
    } catch {
      // A closed stream must not block the rest; its route unsubscribes itself.
    }
  }
}

function deliverAll(event: BusEvent): void {
  for (const topic of state.registry.keys()) deliver(topic, event);
}

function connectRedis(): BusState["redis"] {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (state.redis && state.redisUrl === url) return state.redis;

  const pub = new IORedis(url, { maxRetriesPerRequest: null });
  const sub = new IORedis(url, { maxRetriesPerRequest: null });
  // ioredis re-subscribes on its own after a reconnect.
  sub.subscribe(CHANNEL).catch((err: Error) => {
    console.error("[realtime-bus] subscribe failed", err.message);
  });
  let readyOnce = false;
  sub.on("ready", () => {
    // Publishes from other machines during the outage were lost, so every
    // local stream re-fetches once instead of waiting for its slow sync.
    if (readyOnce) deliverAll("sync");
    readyOnce = true;
  });
  sub.on("message", (channel: string, raw: string) => {
    if (channel !== CHANNEL) return;
    let msg: { topic?: unknown; origin?: unknown; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.topic !== "string" || msg.origin === state.origin) return;
    deliver(msg.topic, "change", typeof msg.data === "string" ? msg.data : undefined);
  });
  const logError = (err: Error) => console.error("[realtime-bus] redis error", err.message);
  pub.on("error", logError);
  sub.on("error", logError);

  state.redis = { pub, sub };
  state.redisUrl = url;
  return state.redis;
}

export function subscribe(topic: string, fn: Subscriber): () => void {
  connectRedis();
  let set = state.registry.get(topic);
  if (!set) {
    set = new Set();
    state.registry.set(topic, set);
  }
  set.add(fn);
  return () => {
    const s = state.registry.get(topic);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) state.registry.delete(topic);
  };
}

export function publish(topic: string, data?: string): void {
  // Local subscribers hear it immediately and still do if Redis is down; the
  // origin tag drops this process's own echo off the channel.
  deliver(topic, "change", data);
  const redis = connectRedis();
  if (!redis) return;
  redis.pub
    .publish(CHANNEL, JSON.stringify({ topic, origin: state.origin, data }))
    .catch((err: Error) => console.error("[realtime-bus] publish failed", err.message));
}

export function __resetRealtimeBusForTests(): void {
  state.redis?.pub.disconnect();
  state.redis?.sub.disconnect();
  state.redis = null;
  state.redisUrl = undefined;
  state.registry.clear();
}
