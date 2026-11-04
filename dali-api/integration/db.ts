import { prisma } from "~/lib/db.server";

let tables: string[] | null = null;

export async function resetDatabase(): Promise<void> {
  tables ??= (
    await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `
  ).map((t) => `"public"."${t.tablename}"`);
  if (tables.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
}

export { prisma };
