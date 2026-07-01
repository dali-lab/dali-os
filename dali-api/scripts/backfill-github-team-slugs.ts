/**
 * Backfill Project.githubTeamSlug for existing projects that don't have one, so
 * the roster→GitHub team sync (staffing board "Sync all current-term teams") can
 * act on them. New projects already get an auto-derived slug on create; this is
 * the one-off pass for projects that predate that.
 *
 * GUIDED, never blind — three buckets:
 *  - ADOPT: the name-derived candidate slug matches a team that ALREADY exists
 *    in GITHUB_ORG → safe to write (only under --commit).
 *  - FLAG-missing: no team with the candidate slug exists — likely a real team
 *    under a different name (e.g. "Smart Microscope" → real team "smart-scope-26x").
 *    Printed for a human to map by hand; never written.
 *  - FLAG-collision: the candidate collides with another project's candidate or
 *    an already-taken slug. Never written (avoids merging two projects into one team).
 *
 * Read-only against GitHub (teams.getByName only — never ensureTeam), so a dry
 * run creates nothing. Excludes archived projects.
 *
 * Dry-run by default. Requires DATABASE_URL, GITHUB_ORG, and GITHUB_APP_* env.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-github-team-slugs.ts          # dry run
 *   npx tsx --env-file .env scripts/backfill-github-team-slugs.ts --commit # write ADOPT bucket
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { githubAppClient, isNotFound } from "../app/lib/github.js";
import { githubTeamSlug } from "../app/lib/github-slug.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const COMMIT = process.argv.includes("--commit");
const ORG = process.env.GITHUB_ORG;

async function teamExists(slug: string): Promise<boolean> {
  try {
    await githubAppClient().rest.teams.getByName({ org: ORG!, team_slug: slug });
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

async function main() {
  if (!ORG) throw new Error("GITHUB_ORG is not set");
  console.log(
    COMMIT
      ? "▶ COMMIT mode — the ADOPT bucket WILL be written.\n"
      : "▶ DRY RUN — no changes will be written. Re-run with --commit to apply.\n",
  );

  const projects = await prisma.project.findMany({
    where: { githubTeamSlug: null, status: { not: "Archived" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Slugs already claimed by other projects — never reuse.
  const taken = new Set(
    (
      await prisma.project.findMany({
        where: { githubTeamSlug: { not: null } },
        select: { githubTeamSlug: true },
      })
    ).map((p) => p.githubTeamSlug!),
  );

  // Count candidate slugs so two null-slug projects that derive to the same
  // slug both land in FLAG-collision.
  const candidateCount = new Map<string, number>();
  for (const p of projects) {
    const c = githubTeamSlug(p.name);
    if (c) candidateCount.set(c, (candidateCount.get(c) ?? 0) + 1);
  }

  const adopt: string[] = [];
  const flagMissing: string[] = [];
  const flagCollision: string[] = [];

  for (const p of projects) {
    const c = githubTeamSlug(p.name);
    if (!c) {
      flagMissing.push(`${p.name} → (empty slug — name has no alphanumerics)`);
      continue;
    }
    if (taken.has(c) || (candidateCount.get(c) ?? 0) > 1) {
      flagCollision.push(`${p.name} → ${c} (collides — resolve by hand)`);
      continue;
    }
    if (await teamExists(c)) {
      adopt.push(`${p.name} → ${c}`);
      if (COMMIT) {
        await prisma.project.update({ where: { id: p.id }, data: { githubTeamSlug: c } });
      }
    } else {
      flagMissing.push(`${p.name} → ${c} (no such team — map to the real slug by hand)`);
    }
  }

  console.log(`ADOPT (${adopt.length})${COMMIT ? " — written" : " — would write"}:`);
  console.log(adopt.length ? "  " + adopt.join("\n  ") : "  (none)");
  console.log(`\nFLAG missing (${flagMissing.length}) — set manually on the project page:`);
  console.log(flagMissing.length ? "  " + flagMissing.join("\n  ") : "  (none)");
  console.log(`\nFLAG collision (${flagCollision.length}) — needs a unique slug:`);
  console.log(flagCollision.length ? "  " + flagCollision.join("\n  ") : "  (none)");
  if (!COMMIT && adopt.length > 0) {
    console.log("\nRe-run with --commit to write the ADOPT bucket.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
