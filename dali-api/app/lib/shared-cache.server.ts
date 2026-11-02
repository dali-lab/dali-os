import IORedis from "ioredis";

// Values every machine can read, in Redis when REDIS_URL is set. Callers treat
// a miss as "compute it", so no Redis, a slow one, or a failed one all read as
// a miss. Its own connection: the realtime bus queues commands through an
// outage, which suits pub/sub and would hang a request here.

const COMMAND_TIMEOUT_MS = 250;

type Client = { redis: IORedis; url: string };
const g = globalThis as unknown as { __sharedCache?: Client };

function client(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (g.__sharedCache?.url === url) return g.__sharedCache.redis;
  const redis = new IORedis(url, {
    commandTimeout: COMMAND_TIMEOUT_MS,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  redis.on("error", (err: Error) => console.error("[shared-cache] redis error", err.message));
  g.__sharedCache = { redis, url };
  return redis;
}

export async function sharedCacheGetMany(keys: string[]): Promise<(string | null)[]> {
  if (keys.length === 0) return [];
  const redis = client();
  if (!redis) return keys.map(() => null);
  try {
    return await redis.mget(keys);
  } catch {
    return keys.map(() => null);
  }
}

export function sharedCacheSet(key: string, value: string, ttlMs: number): void {
  client()
    ?.set(key, value, "PX", ttlMs)
    .catch(() => {});
}

export function __resetSharedCacheForTests(): void {
  g.__sharedCache?.redis.disconnect();
  g.__sharedCache = undefined;
}
