/**
 * Finds users who likely have two account rows: one from CAS (netId set, no
 * daliEmail) and one from Google (@dali.dartmouth.edu daliEmail set, no netId).
 * The heuristic: a Google user's email local-part equals a CAS user's netId.
 *
 * Going-forward, the standalone Google login (auth.callback.google.ts) chains
 * through CAS the first time a new member logs in, and linkCasToGoogleUser
 * merges them. This script surfaces pre-existing duplicates that pre-date the
 * chain, so an operator can resolve them — typically the cheapest fix is to
 * have the affected user log out and log back in with Google; the chain will
 * route them through CAS and the merge happens automatically. For users who
 * have already accumulated data on both rows (applications on CAS-side,
 * project assignments on Google-side), the merge needs a careful per-pair SQL
 * cleanup; this script does NOT automate that.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/find-duplicate-user-accounts.ts
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const googleOnly = await prisma.user.findMany({
    where: { daliEmail: { endsWith: "@dali.dartmouth.edu" }, netId: null },
    select: {
      id: true,
      daliEmail: true,
      firstName: true,
      lastName: true,
      createdAt: true,
    },
  });

  if (googleOnly.length === 0) {
    console.log("No Google-only users found. Nothing to report.");
    return;
  }

  type Candidate = {
    googleId: string;
    googleEmail: string;
    googleCreatedAt: Date;
    casId: string;
    casNetId: string;
    casCreatedAt: Date;
    name: string;
  };
  const candidates: Candidate[] = [];
  const orphans: typeof googleOnly = [];

  for (const g of googleOnly) {
    const localPart = g.daliEmail!.split("@")[0];
    const cas = await prisma.user.findUnique({
      where: { netId: localPart },
      select: { id: true, netId: true, createdAt: true },
    });
    if (cas) {
      candidates.push({
        googleId: g.id,
        googleEmail: g.daliEmail!,
        googleCreatedAt: g.createdAt,
        casId: cas.id,
        casNetId: cas.netId!,
        casCreatedAt: cas.createdAt,
        name: `${g.firstName} ${g.lastName}`,
      });
    } else {
      orphans.push(g);
    }
  }

  console.log(`Total Google-only users (no netId): ${googleOnly.length}`);
  console.log(`  → match a CAS row by netId == daliEmail local-part: ${candidates.length}`);
  console.log(`  → no CAS match (likely fine — chain will be no-op):   ${orphans.length}`);
  console.log();

  if (candidates.length > 0) {
    console.log("Duplicate-pair candidates (review before merging):");
    console.log("─".repeat(100));
    for (const c of candidates) {
      console.log(`  ${c.name}`);
      console.log(`    Google user: ${c.googleId}  ${c.googleEmail}  (created ${c.googleCreatedAt.toISOString()})`);
      console.log(`    CAS user:    ${c.casId}  netId=${c.casNetId}    (created ${c.casCreatedAt.toISOString()})`);
      console.log();
    }
    console.log("Resolution:");
    console.log("  Easiest: have the affected user log out and log back in via Google.");
    console.log("  The standalone Google callback now chains through CAS and the");
    console.log("  linkCasToGoogleUser merge runs automatically.");
    console.log();
    console.log("  If the Google-side user has accumulated data (project assignments,");
    console.log("  tasks, mentor notes, etc.) since being created, prefer a careful");
    console.log("  per-pair SQL cleanup over the chain — the chain deletes the");
    console.log("  Google-side row in favor of the CAS-side row and only re-parents");
    console.log("  Session / OAuthSession / DALIMember.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
