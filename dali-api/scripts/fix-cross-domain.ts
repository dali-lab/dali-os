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

  // Delete old Engineering CycleInterviewer
  const oldCI = await prisma.cycleInterviewer.findFirst({
    where: { userId: morgan.id, applicationCycleId: cycleId },
  });
  if (oldCI) {
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

  // Interview scheduling reads DALI OS calendar availability: working hours
  // (weekdays 2pm-5pm) with no linked calendar means those hours are free.
  await prisma.workingHoursDay.deleteMany({ where: { userId: morgan.id } });
  await prisma.workingHoursDay.createMany({
    data: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ userId: morgan.id, dayOfWeek, startMinute: 14 * 60, endMinute: 17 * 60 })),
  });

  console.log(`Morgan reassigned to Design domain as cross-domain interviewer`);
  console.log(`CycleInterviewer ID: ${newCI.id}`);
  console.log(`Working hours set: weekdays 2pm-5pm`);
  console.log(`\nNow Henry (Engineering, in-domain) + Morgan (Design, cross-domain) can jointly cover Engineering interviews.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
