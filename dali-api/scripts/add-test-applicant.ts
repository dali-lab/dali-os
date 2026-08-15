/**
 * One-off script to add a test applicant to an existing cycle.
 *
 * Usage:
 *   npx tsx scripts/add-test-applicant.ts <cycleId>
 *
 * Example:
 *   npx tsx scripts/add-test-applicant.ts cmo2fvol8001i74nwateht3be
 */

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const cycleId = process.argv[2];
  if (!cycleId) {
    console.error("Usage: npx tsx scripts/add-test-applicant.ts <cycleId>");
    process.exit(1);
  }

  // Find the cycle with its application form, domain forms, and domains
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    include: {
      applicationForm: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } },
      domainChallengeForms: {
        include: { form: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } }, domain: true },
      },
      domains: { include: { domain: true } },
    },
  });

  if (!cycle) {
    console.error(`Cycle ${cycleId} not found.`);
    process.exit(1);
  }

  // Find the general form version
  const generalFormVersion = cycle.applicationForm?.versions[0];
  if (!generalFormVersion) {
    console.error("This cycle has no general application form linked. Link one first.");
    process.exit(1);
  }

  // Pick the first domain that has a challenge form
  if (cycle.domainChallengeForms.length === 0) {
    console.error("This cycle has no domain challenge forms. Link at least one domain first.");
    process.exit(1);
  }

  const domainCdf = cycle.domainChallengeForms[0];
  const domainChallengeFormVersion = domainCdf.form.versions[0];
  if (!domainChallengeFormVersion) {
    console.error("Domain challenge form has no version.");
    process.exit(1);
  }
  const domainName = domainCdf.domain.name;

  // Create test user
  const user = await prisma.user.create({
    data: {
      netId: "testapp01",
      dartmouthEmail: "test.applicant.01@dartmouth.edu",
      firstName: "Test",
      lastName: "Applicant",
    },
  });

  // Create application with a submitted status
  const application = await prisma.application.create({
    data: {
      userId: user.id,
      applicationCycleId: cycleId,
      applicationFormVersionId: generalFormVersion.id,
      answers: {
        "sample-q1": "I want to join DALI because I'm passionate about building real products.",
        "sample-q2": "Sophomore, Computer Science",
      },
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: user.id },
          { newStatus: "Submitted", userId: user.id },
        ],
      },
      domainApplications: {
        create: [
          {
            challengeFormVersionId: domainChallengeFormVersion.id,
            domainId: domainCdf.domainId,
            answers: {
              "sample-dq1": "I've worked with React and Node.js on several projects.",
              "sample-dq2": "https://github.com/testapplicant",
            },
          },
        ],
      },
    },
    include: {
      domainApplications: true,
    },
  });

  console.log("Test applicant created successfully:");
  console.log(`  User: ${user.firstName} ${user.lastName} (${user.dartmouthEmail})`);
  console.log(`  Net ID: ${user.netId} (use /dev-login-as?netId=testapp01 to log in)`);
  console.log(`  Application: ${application.id}`);
  console.log(`  Domain: ${domainName} (${application.domainApplications[0]?.id})`);
  console.log(`  Cycle: ${cycle.name} (${cycle.id})`);
  console.log(`  Status: Submitted`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
