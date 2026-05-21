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

  // Find the cycle with its challenge versions and domains
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    include: {
      challengeVersions: {
        include: { challengeVersion: { include: { domain: true } } },
      },
      domains: { include: { domain: true } },
    },
  });

  if (!cycle) {
    console.error(`Cycle ${cycleId} not found.`);
    process.exit(1);
  }

  // Find the general challenge version (domainId is null)
  const generalCv = cycle.challengeVersions.find(
    (cv) => cv.challengeVersion.domainId === null,
  );
  if (!generalCv) {
    console.error("This cycle has no general challenge version linked. Link one first.");
    process.exit(1);
  }

  // Pick the first domain that has a challenge version
  const domainCvs = cycle.challengeVersions.filter(
    (cv) => cv.challengeVersion.domainId !== null,
  );
  if (domainCvs.length === 0) {
    console.error("This cycle has no domain challenge versions. Link at least one domain first.");
    process.exit(1);
  }

  const domainCv = domainCvs[0];
  const domainName = domainCv.challengeVersion.domain?.name ?? "Unknown";

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
      generalChallengeVersionId: generalCv.challengeVersionId,
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
            challengeVersionId: domainCv.challengeVersionId,
            domainId: domainCv.challengeVersion.domainId!,
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
