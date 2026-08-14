/**
 * Prints each given user's applications — cycle, type, status history, and
 * answer values (truncated) — plus recent session timestamps. Answer text
 * usually contains whatever name/email the applicant typed, which is the
 * fastest way to identify who is behind a User row with no identity columns.
 *
 * Read-only. Requires DATABASE_URL.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/inspect-user-applications.ts <userId> [<userId> ...]
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const userIds = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (userIds.length === 0) {
  console.error("Usage: inspect-user-applications.ts <userId> [<userId> ...]");
  process.exit(1);
}

async function main() {
  for (const userId of userIds) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    console.log(`════ ${userId}  ${user ? `${user.firstName} ${user.lastName}` : "(user not found)"}`);
    if (!user) continue;

    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    console.log(
      `  sessions: ${sessions.length}${sessions.length ? `  (latest ${sessions[0].createdAt.toISOString()}, oldest ${sessions.at(-1)!.createdAt.toISOString()})` : ""}`,
    );

    const apps = await prisma.application.findMany({
      where: { userId },
      include: {
        applicationCycle: { select: { name: true } },
        statusUpdates: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    });
    for (const app of apps) {
      console.log(
        `  application ${app.id}  cycle="${app.applicationCycle.name}"  type=${app.applicationType}  created=${app.createdAt.toISOString()}`,
      );
      console.log(
        `    status: ${app.statusUpdates.map((s) => s.newStatus).join(" → ") || "(no updates)"}`,
      );
      const answers = (app.answers ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(answers)) {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        console.log(`    ${key.slice(0, 8)}… = ${text.slice(0, 150)}`);
      }
    }
    if (apps.length === 0) console.log("  (no applications)");
    console.log();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
