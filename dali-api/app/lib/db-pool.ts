import type { PoolConfig } from "pg";

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
  };
}
