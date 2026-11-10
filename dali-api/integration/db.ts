import { prisma } from "~/lib/db.server";

let tables: string[] | null = null;

async function allTables(): Promise<string[]> {
  tables ??= (
    await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `
  ).map((t) => `"public"."${t.tablename}"`);
  return tables;
}

// Truncating every table recreates each one's files; probing for rows first is far cheaper.
export async function resetDatabase(): Promise<void> {
  const all = await allTables();
  if (all.length === 0) return;
  const probe = all.map((t) => `SELECT '${t.replace(/'/g, "''")}' AS t WHERE EXISTS (SELECT 1 FROM ${t})`).join(" UNION ALL ");
  const dirty = (await prisma.$queryRawUnsafe<{ t: string }[]>(probe)).map((r) => r.t);
  if (dirty.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${dirty.join(", ")} RESTART IDENTITY CASCADE`);
}

export { prisma };
