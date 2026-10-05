/**
 * Local-dev helper: grant AdminMembership (which implies Core) to a user by
 * email. Idempotent — safe to run repeatedly. Not for production use.
 *
 * Usage inside the api container:
 *   docker compose exec api npx tsx scripts/grant-admin.ts <email>
 */
import { prisma } from "../app/lib/db";

async function main() {
  const raw = process.argv[2];
  if (!raw || !raw.trim()) {
    console.error("Usage: tsx scripts/grant-admin.ts <email>");
    process.exit(1);
  }
  const email = raw.trim().toLowerCase();
  try {
    // User identity is split across daliEmail / dartmouthEmail / personalEmail
    // (no single `email` column), so match any of them case-insensitively.
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { daliEmail: { equals: email, mode: "insensitive" } },
          { dartmouthEmail: { equals: email, mode: "insensitive" } },
          { personalEmail: { equals: email, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, daliEmail: true, dartmouthEmail: true, personalEmail: true },
    });
    if (!user) {
      console.error(`No user found with email ${email}. Log in once so a user row is created, then re-run.`);
      process.exit(1);
    }
    const label = user.daliEmail ?? user.dartmouthEmail ?? user.personalEmail ?? user.id;
    const existing = await prisma.adminMembership.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (existing) {
      console.log(`✓ ${label} already has AdminMembership (id=${existing.id}).`);
      return;
    }
    const row = await prisma.adminMembership.create({
      data: { userId: user.id, grantedBy: "scripts/grant-admin.ts" },
    });
    console.log(`✓ Granted AdminMembership to ${label} (user=${user.id}, membership=${row.id}).`);
    console.log("  Admin implies Core, so you'll see the full nav + edit permissions on next request.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
