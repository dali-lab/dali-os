/**
 * Adds a second domain to the cycle and reassigns the test interviewer
 * to it, so there's a cross-domain interviewer available for Engineering applicants.
 *
 * Usage: npx tsx scripts/fix-cross-domain.ts <cycleId>
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const cycleId = process.argv[2];
  if (!cycleId) { console.error("Usage: npx tsx scripts/fix-cross-domain.ts <cycleId>"); process.exit(1); }

  // Find or create a "Design" domain
  let designDomain = await prisma.domain.findFirst({ where: { name: "Design" } });
  if (!designDomain) {
    designDomain = await prisma.domain.create({
      data: { name: "Design", code: "UIUX", displayName: "UI/UX Design" },
    });
    console.log(`Created Design domain: ${designDomain.id}`);
  }

  // Add Design to cycle if not already there
  await prisma.domainApplicationCycle.upsert({
    where: { domainId_applicationCycleId: { domainId: designDomain.id, applicationCycleId: cycleId } },
    update: {},
    create: { domainId: designDomain.id, applicationCycleId: cycleId },
  });
  console.log(`Design domain linked to cycle`);

  // Find Morgan's user record
  const morgan = await prisma.user.findFirst({
    where: { daliEmail: "test.interviewer@dali.dartmouth.edu" },
  });
  if (!morgan) { console.error("Morgan not found"); process.exit(1); }

  // Delete old Engineering CycleInterviewer (and its availability)
  const oldCI = await prisma.cycleInterviewer.findFirst({
    where: { userId: morgan.id, applicationCycleId: cycleId },
  });
  if (oldCI) {
    await prisma.interviewerAvailability.deleteMany({ where: { cycleInterviewerId: oldCI.id } });
    await prisma.cycleInterviewer.delete({ where: { id: oldCI.id } });
    console.log(`Deleted old Engineering CycleInterviewer`);
  }

  // Create new CycleInterviewer under Design
  const newCI = await prisma.cycleInterviewer.create({
    data: {
      userId: morgan.id,
      applicationCycleId: cycleId,
      domainId: designDomain.id,
    },
  });

  // Add availability: next 5 weekdays, 2pm-5pm ET
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  let added = 0;
  while (added < 5) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const start = new Date(cursor); start.setUTCHours(18, 0, 0, 0);
      const end = new Date(cursor); end.setUTCHours(21, 0, 0, 0);
      await prisma.interviewerAvailability.create({
        data: { cycleInterviewerId: newCI.id, startTime: start, endTime: end },
      });
      added++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  console.log(`Morgan reassigned to Design domain as cross-domain interviewer`);
  console.log(`CycleInterviewer ID: ${newCI.id}`);
  console.log(`5 availability blocks added (next 5 weekdays, 2pm-5pm ET)`);
  console.log(`\nNow Henry (Engineering, in-domain) + Morgan (Design, cross-domain) can jointly cover Engineering interviews.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
