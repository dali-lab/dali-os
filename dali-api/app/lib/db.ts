import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

// Re-export the Prisma namespace through this module so callers can reach
// runtime values like `Prisma.DbNull` without a direct value-import of the
// generated client. The unit-test job doesn't run `prisma generate`, but tests
// mock `~/lib/db` (resolvable) — so routing the namespace through here keeps
// those modules loadable in CI. See app/lib/__mocks__/db.ts for the stub.
export { Prisma } from "../generated/prisma/client.js";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// node-postgres defaults to 10 connections per process. One navigation fans
// out 15-20 queries across the shell and page loaders, plus the pollers of
// every other user on the machine, so at 10 a trivial indexed read spends its
// time queued in the pool rather than in Postgres. Prod runs against Neon's
// pooled endpoint (PgBouncer, transaction mode), so the real ceiling is the
// compute's max_connections (hundreds at the current size), not this number.
const DEFAULT_POOL_MAX = 25;

function poolMax(): number {
  const raw = Number(process.env.DATABASE_POOL_MAX);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_POOL_MAX;
}

// Peak queue depth since the last report. Logged only when a query actually
// waited, so a healthy pool is silent and a saturated one names itself in
// `fly logs` as `[pg-pool]`.
const POOL_REPORT_INTERVAL_MS = 30_000;

function watchPoolSaturation(pool: Pool): void {
  let peakWaiting = 0;
  pool.on("acquire", () => {
    if (pool.waitingCount > peakWaiting) peakWaiting = pool.waitingCount;
  });
  const timer = setInterval(() => {
    if (peakWaiting === 0) return;
    console.log(
      `[pg-pool] waiting peak=${peakWaiting} max=${pool.options.max} total=${pool.totalCount} idle=${pool.idleCount}`,
    );
    peakWaiting = 0;
  }, POOL_REPORT_INTERVAL_MS);
  timer.unref();
}

function createPrismaClient() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: poolMax() });
  watchPoolSaturation(pool);
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// On HMR, dispose the old client so Vite can close the module runner cleanly
if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    await prisma.$disconnect();
    delete (globalForPrisma as any).prisma;
  });
}
