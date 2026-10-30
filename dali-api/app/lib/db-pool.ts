import type { Pool, PoolClient, PoolConfig } from "pg";

// node-postgres defaults to 10 connections per process. One navigation fans
// out 15-20 queries across the shell and page loaders, plus the pollers of
// every other user on the machine, so at 10 a trivial indexed read spends its
// time queued in the pool rather than in Postgres. Prod runs against Neon's
// pooled endpoint (PgBouncer, transaction mode), so the real ceiling is the
// compute's max_connections (hundreds at the current size), not this number.
const DEFAULT_POOL_MAX = 25;

// Opening a connection to Neon costs ~100ms from Fly (TLS + auth) against
// ~14ms per query on an open one. pg's 10s idle default closed the pool between
// bursts, so most requests paid that handshake.
const DEFAULT_POOL_MIN = 5;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

// Scripts (the seed, scripts/*.ts) import ~/lib/db.server and never disconnect it.
// Warm idle clients would otherwise hold the event loop open forever; the
// server stays up on its own listener.

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isInteger(n) && n > 0 ? n : fallback;
}

export function poolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const max = positiveInt(env.DATABASE_POOL_MAX, DEFAULT_POOL_MAX);
  return {
    connectionString: env.DATABASE_URL,
    max,
    min: Math.min(positiveInt(env.DATABASE_POOL_MIN, DEFAULT_POOL_MIN), max),
    idleTimeoutMillis: positiveInt(env.DATABASE_POOL_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
    allowExitOnIdle: true,
  };
}

// pg-pool queues every checkout for a tick even when clients are idle, so its
// waitingCount reads high on any same-tick burst. Timing the checkout itself
// only counts real waits: a full pool or a fresh connection handshake.
const SLOW_CHECKOUT_MS = 5;
const POOL_REPORT_INTERVAL_MS = 30_000;

type ConnectCallback = (err: Error | undefined, client?: PoolClient, done?: () => void) => void;

export function watchPoolWaits(
  pool: Pool,
  { now = () => performance.now(), log = console.log } = {},
): () => void {
  let checkouts = 0;
  let slow = 0;
  let maxWaitMs = 0;
  const record = (startedAt: number) => {
    const waited = now() - startedAt;
    checkouts++;
    if (waited >= SLOW_CHECKOUT_MS) slow++;
    if (waited > maxWaitMs) maxWaitMs = waited;
  };

  const connect = pool.connect.bind(pool) as (cb?: ConnectCallback) => Promise<PoolClient> | void;
  (pool as { connect: unknown }).connect = (cb?: ConnectCallback) => {
    const startedAt = now();
    if (cb) {
      return connect((err, client, done) => {
        record(startedAt);
        cb(err, client, done);
      });
    }
    return (connect() as Promise<PoolClient>).then(
      (client) => {
        record(startedAt);
        return client;
      },
      (err: unknown) => {
        record(startedAt);
        throw err;
      },
    );
  };

  const report = () => {
    if (slow > 0) {
      log(
        `[pg-pool] slow checkouts=${slow}/${checkouts} maxWait=${Math.round(maxWaitMs)}ms max=${pool.options.max} total=${pool.totalCount} idle=${pool.idleCount}`,
      );
    }
    checkouts = 0;
    slow = 0;
    maxWaitMs = 0;
  };
  const timer = setInterval(report, POOL_REPORT_INTERVAL_MS);
  timer.unref();
  return report;
}
