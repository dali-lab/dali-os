import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
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
