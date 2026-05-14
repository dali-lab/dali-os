/**
 * One-off script to add a test cross-domain interviewer with availability
 * to an existing cycle.
 *
 * Usage:
 *   npx tsx scripts/add-test-interviewer.ts <cycleId>
 */

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const cycleId = process.argv[2];
  if (!cycleId) {
    console.error("Usage: npx tsx scripts/add-test-interviewer.ts <cycleId>");
    process.exit(1);
  }

  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    include: {
      domains: { include: { domain: true } },
      interviewConfig: true,
    },
  });

  if (!cycle) {
    console.error(`Cycle ${cycleId} not found.`);
    process.exit(1);
  }

  // Pick a non-Engineering domain for cross-domain interviewing
  const engDomain = cycle.domains.find((d) => d.domain.name === "Engineering");
  const crossDomain = cycle.domains.find((d) => d.domain.name !== "Engineering");
  const domainForInterviewer = crossDomain ?? cycle.domains[0];

  if (!domainForInterviewer) {
    console.error("No domains in this cycle.");
    process.exit(1);
  }

  // Create a DALI member user for the interviewer
  const user = await prisma.user.upsert({
    where: { daliEmail: "test.interviewer@dali.dartmouth.edu" },
    update: {},
    create: {
      daliEmail: "test.interviewer@dali.dartmouth.edu",
      firstName: "Morgan",
      lastName: "Cross-Domain",
    },
  });

  await prisma.dALIMember.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  // Create CycleInterviewer for the cross-domain
  const ci = await prisma.cycleInterviewer.upsert({
    where: {
      userId_applicationCycleId_domainId: {
        userId: user.id,
        applicationCycleId: cycleId,
        domainId: domainForInterviewer.domainId,
      },
    },
    update: {},
    create: {
      userId: user.id,
      applicationCycleId: cycleId,
      domainId: domainForInterviewer.domainId,
    },
  });

  // Add availability blocks — next 5 weekdays, 2pm-5pm ET (18:00-21:00 UTC)
  await prisma.interviewerAvailability.deleteMany({
    where: { cycleInterviewerId: ci.id },
  });

  const now = new Date();
  let added = 0;
  const cursor = new Date(now);
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() + 1); // start tomorrow

  while (added < 5) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const start = new Date(cursor);
      start.setUTCHours(18, 0, 0, 0); // 2pm ET
      const end = new Date(cursor);
      end.setUTCHours(21, 0, 0, 0); // 5pm ET

      await prisma.interviewerAvailability.create({
        data: {
          cycleInterviewerId: ci.id,
          startTime: start,
          endTime: end,
        },
      });
      added++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  console.log("Test cross-domain interviewer created:");
  console.log(`  Name: ${user.firstName} ${user.lastName}`);
  console.log(`  DALI email: ${user.daliEmail} (use /dev-login-as?daliEmail=test.interviewer@dali.dartmouth.edu)`);
  console.log(`  Domain: ${domainForInterviewer.domain.name} (cross-domain for Engineering interviews)`);
  console.log(`  Availability: next 5 weekdays, 2pm-5pm ET`);
  console.log(`  CycleInterviewer ID: ${ci.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
