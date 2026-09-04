import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Resolve the URL the Prisma CLI should use.
//
// Why: `prisma migrate deploy` takes a session-scoped `pg_advisory_lock`. Neon's
// pooled endpoint does PgBouncer-style transaction pooling, so the lock and
// unlock can land on different backend sessions and acquisition times out
// (P1002). See dali-api/prisma/MIGRATIONS.md and issue #101.
//
// `prisma.config.ts` is loaded only by the Prisma CLI; the app runtime builds
// its own client from process.env.DATABASE_URL (see app/lib/db.ts), so the URL
// chosen here does not affect runtime traffic.
//
// Resolution order:
//   1. Explicit DIRECT_URL wins.
//   2. Else, if DATABASE_URL is a Neon pooled host
//      (`<endpoint>-pooler.<region>.aws.neon.tech`), strip `-pooler` to get
//      the non-pooled twin.
//   3. Else (local Docker, CI postgres:16 — no pooler), use DATABASE_URL as-is.
function resolveCliUrl(): string | undefined {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return undefined;
  try {
    const url = new URL(databaseUrl);
    if (url.hostname.includes("-pooler.")) {
      url.hostname = url.hostname.replace("-pooler.", ".");
      return url.toString();
    }
  } catch {
    // Not parseable; let Prisma surface its own error.
  }
  return databaseUrl;
}

const cliUrl = resolveCliUrl();

// Fail loud if a migrate command would still hit a pooled host. Without this
// guard, the failure mode is an opaque 10-second advisory-lock timeout.
const isMigrateCommand = process.argv.includes("migrate");
if (isMigrateCommand && cliUrl) {
  try {
    if (new URL(cliUrl).hostname.includes("-pooler.")) {
      throw new Error(
        "prisma migrate would run against a pooled Neon endpoint, which deadlocks on pg_advisory_lock. " +
          "Resolved URL host still contains '-pooler'. " +
          "Set DIRECT_URL to a non-pooled endpoint, or fix DATABASE_URL. " +
          "See dali-api/prisma/MIGRATIONS.md.",
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("prisma migrate")) throw err;
    // URL was unparseable; let Prisma surface its own error downstream.
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: cliUrl ?? env("DATABASE_URL"),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
