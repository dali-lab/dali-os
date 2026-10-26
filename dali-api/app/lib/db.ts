import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { runDbOperationHooks } from "~/lib/db-write-hooks";
import { poolConfig, watchPoolWaits } from "~/lib/db-pool";

// Re-export the Prisma namespace through this module so callers can reach
// runtime values like `Prisma.DbNull` without a direct value-import of the
// generated client. The unit-test job doesn't run `prisma generate`, but tests
// mock `~/lib/db` (resolvable) — so routing the namespace through here keeps
// those modules loadable in CI. See app/lib/__mocks__/db.ts for the stub.
export { Prisma } from "../generated/prisma/client.js";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function createPrismaClient(): PrismaClient {
  const pool = new Pool(poolConfig());
  watchPoolWaits(pool);
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  // A query-only extension leaves the client API unchanged, and its extended
  // type is heavy enough to exhaust tsc, so it is typed as the plain client.
  const client = new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(args);
          runDbOperationHooks(model, operation);
          return result;
        },
      },
    },
  });
  return client as unknown as PrismaClient;
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
