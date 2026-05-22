// Create a User + Application + DomainApplication rows for someone who emailed
// their materials but never made an account. After this runs, the row IDs it
// prints can be fed into manual-submit.ts to attach answers + submit.
//
// SAFETY: defaults to preview mode. Pass --execute to actually write.
//
// Auth-safety: both Google (Dartmouth) and CAS auth upsert by dartmouthEmail
// and netId respectively, so the row we create here will be reused when the
// applicant eventually logs in — no duplicate User row will appear.
//
// Usage:
//   tsx --env-file .env scripts/bootstrap-application.ts \
//     --first "Brendon" --last "Bazzani" \
//     --netid f007b37 \
//     --email "Brendon.R.Bazzani.28@dartmouth.edu" \
//     --cycle <cycleId> \
//     --domain "Engineering" \
//     [--execute]
//
// --domain can be repeated to select multiple. Domain names match the Domain
// table's "name" field (case-insensitive); the script lists valid names if
// one doesn't match.

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

type Args = {
  first?: string;
  last?: string;
  netid?: string;
  email?: string;
  cycle?: string;
  domains: string[];
  execute: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { domains: [], execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--first") out.first = argv[++i];
    else if (a === "--last") out.last = argv[++i];
    else if (a === "--netid") out.netid = argv[++i];
    else if (a === "--email") out.email = argv[++i];
    else if (a === "--cycle") out.cycle = argv[++i];
    else if (a === "--domain") out.domains.push(argv[++i]);
    else if (a === "--execute") out.execute = true;
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

function unquote(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

const args = parseArgs(process.argv.slice(2));
if (!args.first || !args.last || !args.netid || !args.cycle || args.domains.length === 0) {
  console.error("Required: --first, --last, --netid, --cycle, --domain (one or more). Optional: --email (defaults to <netid>@dartmouth.edu)");
  process.exit(2);
}
const dartmouthEmail = args.email ?? `${args.netid}@dartmouth.edu`;

const DATABASE_URL = unquote(process.env.DATABASE_URL);
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(2); }

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

console.log(`Mode: ${args.execute ? "EXECUTE (will write)" : "PREVIEW (no writes)"}`);
console.log(`DB: ${DATABASE_URL.split("@")[1]?.split("/")[0] ?? "?"}`);
console.log();

try {
  // ─── Validate cycle ──────────────────────────────────────────────────────
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: args.cycle },
    select: {
      id: true,
      name: true,
      challengeVersions: {
        select: {
          challengeVersion: {
            select: { id: true, domain: { select: { id: true, name: true } } },
          },
        },
      },
      domains: { select: { domain: { select: { id: true, name: true } } } },
    },
  });
  if (!cycle) throw new Error(`Cycle ${args.cycle} not found`);
  console.log(`Cycle: ${cycle.name} (${cycle.id})`);

  // ─── Find the general challenge version + domain CVs for the cycle ──────
  const generalCv = cycle.challengeVersions.find(c => c.challengeVersion.domain === null);
  if (!generalCv) throw new Error(`Cycle has no general challenge version linked`);
  const generalCvId = generalCv.challengeVersion.id;

  const domainCvByDomainId = new Map<string, string>();
  for (const c of cycle.challengeVersions) {
    if (c.challengeVersion.domain) {
      domainCvByDomainId.set(c.challengeVersion.domain.id, c.challengeVersion.id);
    }
  }

  // ─── Resolve requested domain names → domain ids ────────────────────────
  const validDomainNames = cycle.domains.map(d => d.domain.name);
  const resolved: { id: string; name: string; cvId: string }[] = [];
  for (const wanted of args.domains) {
    const match = cycle.domains.find(d => d.domain.name.toLowerCase() === wanted.toLowerCase());
    if (!match) {
      throw new Error(`Domain "${wanted}" not hiring this cycle. Available: ${validDomainNames.join(", ")}`);
    }
    const cvId = domainCvByDomainId.get(match.domain.id);
    if (!cvId) throw new Error(`Domain "${match.domain.name}" has no challenge version linked`);
    resolved.push({ id: match.domain.id, name: match.domain.name, cvId });
  }

  // ─── Check for existing User row ────────────────────────────────────────
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { netId: args.netid },
        { dartmouthEmail: dartmouthEmail },
      ],
    },
    select: { id: true, netId: true, dartmouthEmail: true, firstName: true, lastName: true },
  });

  let existingApp: { id: string; domainApplications: { id: string; selected: boolean; challengeVersion: { domain: { id: string; name: string } | null } }[] } | null = null;
  if (existingUser) {
    console.log(`Existing User found — will reuse:`);
    console.log(`  id: ${existingUser.id}`);
    console.log(`  ${existingUser.firstName} ${existingUser.lastName}  netId=${existingUser.netId}  email=${existingUser.dartmouthEmail}`);

    existingApp = await prisma.application.findUnique({
      where: { userId_applicationCycleId: { userId: existingUser.id, applicationCycleId: cycle.id } },
      select: {
        id: true,
        domainApplications: {
          select: {
            id: true,
            selected: true,
            challengeVersion: { select: { domain: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (existingApp) {
      console.log(`  has Application: ${existingApp.id}`);
      for (const da of existingApp.domainApplications) {
        console.log(`    da: ${da.id}  domain: ${da.challengeVersion.domain?.name ?? "?"}  selected: ${da.selected}`);
      }
    }
  } else {
    console.log(`No existing User — will create:`);
    console.log(`  netId: ${args.netid}`);
    console.log(`  dartmouthEmail: ${dartmouthEmail}`);
    console.log(`  name: ${args.first} ${args.last}`);
  }

  console.log();

  // ─── Branch: augment existing Application vs. create new ────────────────
  if (existingApp) {
    const existingDomainIds = new Set(
      existingApp.domainApplications
        .map(da => da.challengeVersion.domain?.id)
        .filter((id): id is string => !!id),
    );
    const toCreate = cycle.domains.filter(d => !existingDomainIds.has(d.domain.id));
    const toReselect = existingApp.domainApplications.filter(da =>
      da.challengeVersion.domain &&
      resolved.some(r => r.id === da.challengeVersion.domain!.id) &&
      !da.selected,
    );

    console.log(`Augmenting existing Application ${existingApp.id}:`);
    if (toCreate.length === 0 && toReselect.length === 0) {
      console.log(`  nothing to do — all cycle domains have DAs and requested domains are selected`);
      await prisma.$disconnect();
      process.exit(0);
    }
    for (const d of toCreate) {
      const selected = resolved.some(r => r.id === d.domain.id);
      console.log(`  CREATE DomainApplication: ${d.domain.name} (selected: ${selected})`);
    }
    for (const da of toReselect) {
      console.log(`  UPDATE DomainApplication ${da.id} (${da.challengeVersion.domain?.name}): selected false → true`);
    }

    if (!args.execute) {
      console.log();
      console.log(`PREVIEW — no writes`);
      await prisma.$disconnect();
      process.exit(0);
    }

    await prisma.$transaction(async tx => {
      for (const d of toCreate) {
        const cvId = domainCvByDomainId.get(d.domain.id);
        if (!cvId) continue;
        const selected = resolved.some(r => r.id === d.domain.id);
        await tx.domainApplication.create({
          data: {
            applicationId: existingApp!.id,
            challengeVersionId: cvId,
            selected,
            answers: {},
          },
        });
      }
      for (const da of toReselect) {
        await tx.domainApplication.update({ where: { id: da.id }, data: { selected: true } });
      }
    });

    console.log();
    console.log(`✓ EXECUTED`);
    console.log(`  application_id: ${existingApp.id}`);
    const refreshed = await prisma.domainApplication.findMany({
      where: { applicationId: existingApp.id },
      select: { id: true, selected: true, challengeVersion: { select: { domain: { select: { name: true } } } } },
    });
    for (const da of refreshed) {
      console.log(`  da [${da.selected ? "selected" : "deselected"}]: ${da.id}  domain: ${da.challengeVersion.domain?.name ?? "?"}`);
    }
    console.log();
    console.log(`Next: use manual-submit.ts with the application_id + the selected da_id(s).`);
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(`Will create Application in cycle ${cycle.id}`);
  console.log(`  generalChallengeVersionId: ${generalCvId}`);
  for (const d of resolved) {
    console.log(`  DomainApplication: ${d.name} (challengeVersionId: ${d.cvId}, selected: true)`);
  }
  for (const d of cycle.domains) {
    if (!resolved.some(r => r.id === d.domain.id)) {
      console.log(`  DomainApplication: ${d.domain.name} (selected: false — created but deselected)`);
    }
  }

  if (!args.execute) {
    console.log();
    console.log(`PREVIEW — no writes`);
    await prisma.$disconnect();
    process.exit(0);
  }

  // ─── Execute in transaction ─────────────────────────────────────────────
  const result = await prisma.$transaction(async tx => {
    const user = existingUser ?? await tx.user.create({
      data: {
        netId: args.netid!,
        dartmouthEmail,
        firstName: args.first!,
        lastName: args.last!,
      },
      select: { id: true },
    });

    const app = await tx.application.create({
      data: {
        userId: user.id,
        applicationCycleId: cycle.id,
        generalChallengeVersionId: generalCvId,
        answers: {},
      },
      select: { id: true },
    });

    await tx.applicationStatusUpdate.create({
      data: { newStatus: "Draft", applicationId: app.id, userId: user.id },
    });

    // One DomainApplication per cycle-hiring domain, mirroring how the apply
    // form creates them. Selected = true only for the requested domains.
    const dasCreated: { id: string; name: string; selected: boolean }[] = [];
    for (const d of cycle.domains) {
      const cvId = domainCvByDomainId.get(d.domain.id);
      if (!cvId) continue;
      const selected = resolved.some(r => r.id === d.domain.id);
      const da = await tx.domainApplication.create({
        data: {
          applicationId: app.id,
          challengeVersionId: cvId,
          selected,
          answers: {},
        },
        select: { id: true },
      });
      dasCreated.push({ id: da.id, name: d.domain.name, selected });
    }

    return { userId: user.id, applicationId: app.id, dasCreated };
  });

  console.log();
  console.log(`✓ EXECUTED`);
  console.log(`  user_id: ${result.userId}`);
  console.log(`  application_id: ${result.applicationId}`);
  for (const da of result.dasCreated) {
    console.log(`  da [${da.selected ? "selected" : "deselected"}]: ${da.id}  domain: ${da.name}`);
  }
  console.log();
  console.log(`Next: use manual-submit.ts with the application_id + the selected da_id(s) to attach answers and submit.`);
} catch (err) {
  console.error(`FAIL — ${(err as Error).message}`);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
