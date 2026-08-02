// Seed a few applicants with a FINAL Accepted decision in an existing cycle, so
// you can exercise the full release → onboarding pipeline from the hiring-lead
// UI: open the cycle's decisions, click "Release" on one of these, and watch
// promote → provision → welcome (email goes to sophie.park in dev/staging).
//
// Attaches to the "Fall 2026" cycle (cycle-fall-2026), which already has the
// Accepted email-template binding + a bound confidentiality agreement. We also
// add the missing confidentiality SIGNATURE for the releasing admin (otherwise
// release 403s).
//
// Idempotent: users upserted by dartmouthEmail; application upserted by the
// (user, cycle) unique; we only create a Final decision if the applicant has no
// existing decision yet.
//
// Usage:
//   npx tsx --env-file .env prisma/seeds/releasable-accepted.ts
import { PrismaClient } from "../../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const CYCLE_ID = "cycle-fall-2026";

// (first, last, domain code). Dartmouth email is derived; it's only the
// nominal recipient — in dev/staging the welcome email is redirected to
// sophie.park by welcome.server.
const APPLICANTS = [
  { firstName: "Nadia", lastName: "Brooks", domainCode: "Fullstack" },
  { firstName: "Theo", lastName: "Nguyen", domainCode: "UIUX" },
  { firstName: "Priya", lastName: "Raman", domainCode: "PM" },
];

function netIdFor(first: string, last: string): string {
  return `${first}.${last}.cand`.toLowerCase();
}

async function main() {
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: CYCLE_ID },
    select: { id: true, name: true },
  });
  if (!cycle) throw new Error(`Cycle ${CYCLE_ID} not found — run the base seed first.`);

  // The releasing hiring lead: an admin. They must have signed the cycle's
  // confidentiality agreement or release 403s.
  const admin = await prisma.adminMembership.findFirst({
    select: { userId: true, user: { select: { firstName: true } } },
  });
  if (!admin) throw new Error("No admin user found to act as releaser.");

  const binding = await prisma.signingBinding.findFirst({
    where: { cycleId: CYCLE_ID, document: { kind: "Confidentiality" } },
    select: { id: true, versionId: true },
  });
  if (binding) {
    const existingSig = await prisma.signingSignature.findFirst({
      where: { bindingId: binding.id, signerUserId: admin.userId, roleKey: "member" },
      select: { id: true },
    });
    if (!existingSig) {
      await prisma.signingSignature.create({
        data: {
          bindingId: binding.id,
          versionId: binding.versionId,
          signerUserId: admin.userId,
          roleKey: "member",
          typedName: "",
          fieldValues: {},
        },
      });
      console.log(`  ✓ signed confidentiality for releaser (${admin.user.firstName})`);
    }
  }

  let made = 0;
  for (const a of APPLICANTS) {
    const domain = await prisma.domain.findUnique({
      where: { code: a.domainCode },
      select: { id: true, displayName: true },
    });
    if (!domain) {
      console.warn(`  ⊘ domain "${a.domainCode}" not found — skipping ${a.firstName}.`);
      continue;
    }

    const netId = netIdFor(a.firstName, a.lastName);
    const dartmouthEmail = `${netId}@dartmouth.edu`;

    // Applicant User (no daliEmail yet — that's created at acceptance/provision).
    const user = await prisma.user.upsert({
      where: { netId },
      update: { firstName: a.firstName, lastName: a.lastName, dartmouthEmail },
      create: { netId, firstName: a.firstName, lastName: a.lastName, dartmouthEmail },
      select: { id: true },
    });

    // Application for this cycle (unique on user+cycle).
    const application = await prisma.application.upsert({
      where: { userId_applicationCycleId: { userId: user.id, applicationCycleId: CYCLE_ID } },
      update: {},
      create: {
        userId: user.id,
        applicationCycleId: CYCLE_ID,
        answers: {},
        applicationType: "Standard",
      },
      select: { id: true },
    });

    // DomainApplication (domain linked directly so release can resolve it).
    let domainApp = await prisma.domainApplication.findFirst({
      where: { applicationId: application.id, domainId: domain.id },
      select: { id: true },
    });
    if (!domainApp) {
      domainApp = await prisma.domainApplication.create({
        data: { applicationId: application.id, domainId: domain.id, answers: {}, selected: true },
        select: { id: true },
      });
    }

    // A FINAL Accepted decision, ready for the UI's Release button. Only create
    // if this domain app has no decision yet (so re-running doesn't pile them up).
    const existingDecision = await prisma.decision.findFirst({
      where: { domainApplicationId: domainApp.id },
      select: { id: true },
    });
    if (!existingDecision) {
      const draft = await prisma.decision.create({
        data: {
          domainApplicationId: domainApp.id,
          type: "Accepted",
          stage: "Draft",
          madeById: admin.userId,
        },
        select: { id: true },
      });
      await prisma.decision.create({
        data: {
          domainApplicationId: domainApp.id,
          type: "Accepted",
          stage: "Final",
          madeById: admin.userId,
          parentDecisionId: draft.id,
        },
      });
      made++;
      console.log(`  ✓ ${a.firstName} ${a.lastName} — Final Accepted in ${domain.displayName} (releasable)`);
    } else {
      console.log(`  = ${a.firstName} ${a.lastName} — already has a decision; left as-is`);
    }
  }

  console.log(
    `\nSeeded ${made} releasable Accepted decision(s) in "${cycle.name}".`,
  );
  console.log(
    "Open the hiring lead view for Fall 2026, find these applicants, and click Release.",
  );
  console.log(
    "In dev/staging the welcome email is redirected to sophie.park@dali.dartmouth.edu.",
  );
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
