// One-shot test setup: seeds availability for Riley (in-domain Engineering
// reviewer for Alice's app) and creates a new cross-domain reviewer ("Sam Cross"
// in Design) with the SAME availability window. Then mints a JWT for Alice so
// the operator can drop it into a browser cookie and view the applicant portal.
//
// Run: docker compose exec api npx tsx prisma/test-slots-setup.ts

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { signAccessToken } from "../app/lib/auth.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const cycleId = "cycle-fall-2026";

  // ── Fix seed status-update timestamps ──
  // The seed creates multiple statusUpdate rows in one prisma operation, so
  // they share createdAt — `orderBy: createdAt desc` returns an arbitrary one.
  // Re-stamp them so the intended latest is actually latest.
  const cycleStatuses = await prisma.applicationCycleStatusUpdate.findMany({
    where: { applicationCycleId: cycleId },
    orderBy: { id: "asc" },
  });
  const order = ["Draft", "Open", "Closed", "DecisionsReleased"];
  cycleStatuses.sort(
    (a, b) => order.indexOf(a.newStatus) - order.indexOf(b.newStatus),
  );
  for (let i = 0; i < cycleStatuses.length; i++) {
    await prisma.applicationCycleStatusUpdate.update({
      where: { id: cycleStatuses[i]!.id },
      data: { createdAt: new Date(Date.now() - (cycleStatuses.length - i) * 1000) },
    });
  }
  const aliceAppStatuses = await prisma.applicationStatusUpdate.findMany({
    where: { applicationId: "app-alice" },
    orderBy: { id: "asc" },
  });
  const appOrder = ["Draft", "Submitted", "Withdrawn"];
  aliceAppStatuses.sort(
    (a, b) => appOrder.indexOf(a.newStatus) - appOrder.indexOf(b.newStatus),
  );
  for (let i = 0; i < aliceAppStatuses.length; i++) {
    await prisma.applicationStatusUpdate.update({
      where: { id: aliceAppStatuses[i]!.id },
      data: { createdAt: new Date(Date.now() - (aliceAppStatuses.length - i) * 1000) },
    });
  }
  console.log("✓ Re-stamped status updates so latest-status queries are deterministic");

  // Tomorrow 10:00 → 12:00 in America/New_York. To avoid timezone math,
  // express in UTC: NY is UTC-5 (or -4 in DST). We'll use 14:00–16:00 UTC
  // which is 10:00–12:00 EST or 09:00–11:00 EDT — close enough for a test
  // window inside the seeded 9 AM–6 PM working hours.
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  // Skip weekends: bump to Monday if Sat/Sun
  while (tomorrow.getUTCDay() === 0 || tomorrow.getUTCDay() === 6) {
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  }
  const startTime = new Date(tomorrow);
  startTime.setUTCHours(14, 0, 0, 0);
  const endTime = new Date(tomorrow);
  endTime.setUTCHours(16, 0, 0, 0);

  console.log(`Window: ${startTime.toISOString()} → ${endTime.toISOString()}`);

  // ── In-domain reviewer (Riley Engineer, already seeded for Eng) ──
  const riley = await prisma.user.findUniqueOrThrow({
    where: { netId: "rev001" },
    include: { daliMember: true },
  });
  const rileyReviewer = await prisma.cycleReviewer.findUniqueOrThrow({
    where: {
      daliMemberId_applicationCycleId: {
        daliMemberId: riley.daliMember!.id,
        applicationCycleId: cycleId,
      },
    },
  });
  // Replace any existing availability with our test window
  await prisma.reviewerAvailability.deleteMany({
    where: { cycleReviewerId: rileyReviewer.id },
  });
  await prisma.reviewerAvailability.create({
    data: { cycleReviewerId: rileyReviewer.id, startTime, endTime },
  });
  console.log(`✓ Riley (in-domain Engineering) availability set`);

  // ── New cross-domain fake reviewer: Sam Cross (Design) ──
  const designDomain = await prisma.domain.findFirstOrThrow({
    where: { name: "Design" },
  });
  const sam = await prisma.user.upsert({
    where: { netId: "rev-sam-cross" },
    update: {},
    create: {
      netId: "rev-sam-cross",
      daliEmail: "sam.cross@dali.dartmouth.edu",
      firstName: "Sam",
      lastName: "Cross",
      daliMember: { create: { daliEmail: "sam.cross@dali.dartmouth.edu" } },
    },
    include: { daliMember: true },
  });
  const samReviewer = await prisma.cycleReviewer.upsert({
    where: {
      daliMemberId_applicationCycleId: {
        daliMemberId: sam.daliMember!.id,
        applicationCycleId: cycleId,
      },
    },
    update: {},
    create: {
      daliMemberId: sam.daliMember!.id,
      applicationCycleId: cycleId,
      domainId: designDomain.id,
      isLead: false,
    },
  });
  await prisma.reviewerAvailability.deleteMany({
    where: { cycleReviewerId: samReviewer.id },
  });
  await prisma.reviewerAvailability.create({
    data: { cycleReviewerId: samReviewer.id, startTime, endTime },
  });
  console.log(`✓ Sam Cross (cross-domain Design) created with same availability`);

  // ── Mint a JWT for Alice (the Engineering applicant) ──
  const alice = await prisma.user.findUniqueOrThrow({
    where: { netId: "f007al1" },
  });
  const token = await signAccessToken({
    sub: alice.id,
    email: alice.dartmouthEmail!,
    type: "applicant",
    firstName: alice.firstName,
    lastName: alice.lastName,
  });

  console.log("\n──────── Alice JWT (paste into __dali_at cookie on :3001) ────────");
  console.log(token);
  console.log("\n──────── User payload (paste into __dali_user cookie on :5173) ────────");
  console.log(
    JSON.stringify({
      id: alice.id,
      email: alice.dartmouthEmail,
      firstName: alice.firstName,
      lastName: alice.lastName,
      type: "applicant",
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
