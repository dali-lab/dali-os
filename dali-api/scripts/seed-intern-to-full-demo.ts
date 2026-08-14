// Dev script that stands up an InternToFull cycle end-to-end on a local DB.
//
// What it does (idempotent — re-run safe):
//   1. Ensures an intern-program Domain (ERAS) and a target Domain (Engineering).
//   2. Ensures a Term that covers today's date.
//   3. Creates a test "intern" User + DALIMember and assigns them to a Project
//      in the ERAS domain for the active Term — this is what makes them
//      eligible for the InternToFull flow.
//   4. Ensures a reviewer User + DALIMember + AdminMembership (so they can also
//      release decisions during testing).
//   5. Creates a tiny ShortformVersion (2 questions) and a Rubric.
//   6. Creates an InternToFull ApplicationCycle, binds the form + target
//      domains + rubric + reviewers, and transitions it to Open.
//   7. Prints next-step URLs.
//
// Usage:
//   cd dali-api
//   npm run db:reset:local        # optional — start from a clean DB
//   DATABASE_URL=postgresql://dali:dali@localhost:5432/dali \
//     tsx scripts/seed-intern-to-full-demo.ts
//
// After it runs you can:
//   - Log in as intern@dali.dartmouth.edu (use /dev-login-as) and open
//     /intern-to-full to submit a shortform.
//   - Log in as admin@dali.dartmouth.edu to review at /hiring/reviewer and
//     release decisions at /hiring/lead/intern-to-full-cycle/<id>.

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const now = new Date();
  console.log(`Seeding InternToFull demo @ ${now.toISOString()}\n`);

  // 1. Domains -----------------------------------------------------------------
  const internDomain = await prisma.domain.upsert({
    where: { code: "ERAS" },
    update: { isInternProgram: true, active: true },
    create: {
      name: "ERAS Intern",
      code: "ERAS",
      displayName: "ERAS Intern",
      isInternProgram: true,
      active: true,
    },
  });
  // Use the existing local-seed Engineering domain if it's there; otherwise
  // create one. Both flows leave us with a stable target Domain.
  const engDomain = await prisma.domain.upsert({
    where: { code: "Fullstack" },
    update: { displayName: "Engineering", isInternProgram: false, active: true },
    create: {
      id: "domain-eng",
      name: "Engineering",
      code: "Fullstack",
      displayName: "Engineering",
      isInternProgram: false,
      active: true,
    },
  });
  console.log(`✓ Domains: intern=${internDomain.code}, target=${engDomain.code}`);

  // 2. Term covering today -----------------------------------------------------
  const start = new Date(now);
  start.setMonth(start.getMonth() - 1);
  const end = new Date(now);
  end.setMonth(end.getMonth() + 2);
  const termCode = `${now.getFullYear() % 100}X`; // 26X etc — distinct from prod codes
  const term = await prisma.term.upsert({
    where: { code: termCode },
    update: { startDate: start, endDate: end },
    create: {
      code: termCode,
      year: now.getFullYear(),
      season: "X",
      sortKey: now.getFullYear() * 10 + 9, // off-grid sortKey so it doesn't collide
      startDate: start,
      endDate: end,
    },
  });
  console.log(`✓ Active term: ${term.code} (${start.toDateString()} → ${end.toDateString()})`);

  // 3. Intern user + ProjectAssignment ----------------------------------------
  const intern = await prisma.user.upsert({
    where: { daliEmail: "intern@dali.dartmouth.edu" },
    update: { firstName: "Test", lastName: "Intern" },
    create: {
      daliEmail: "intern@dali.dartmouth.edu",
      firstName: "Test",
      lastName: "Intern",
      daliMember: { create: {} },
    },
    include: { daliMember: true },
  });
  if (!intern.daliMember) {
    await prisma.dALIMember.create({ data: { userId: intern.id } });
  }

  // Project in the intern domain — needs a name and a term in its set.
  const project = await prisma.project.upsert({
    where: { id: "demo-intern-project" },
    update: { name: "ERAS Demo Project" },
    create: {
      id: "demo-intern-project",
      name: "ERAS Demo Project",
    },
  });
  await prisma.projectTerm.upsert({
    where: { projectId_termId: { projectId: project.id, termId: term.id } },
    update: {},
    create: { projectId: project.id, termId: term.id },
  });

  await prisma.projectAssignment.upsert({
    where: {
      userId_projectId_termId_domainId: {
        userId: intern.id,
        projectId: project.id,
        termId: term.id,
        domainId: internDomain.id,
      },
    },
    update: { level: "P1" },
    create: {
      userId: intern.id,
      projectId: project.id,
      termId: term.id,
      domainId: internDomain.id,
      level: "P1",
    },
  });
  console.log(`✓ Intern: ${intern.daliEmail} assigned to ${internDomain.code} in ${term.code}`);

  // 4. Reviewer / hiring lead --------------------------------------------------
  // Reuse admin if present; otherwise create one. The default seed.ts creates
  // admin@dali.dartmouth.edu — we just ensure it's set up correctly here too
  // for the case where this script runs without the full seed.
  const admin = await prisma.user.upsert({
    where: { daliEmail: "admin@dali.dartmouth.edu" },
    update: { firstName: "Admin", lastName: "User" },
    create: {
      daliEmail: "admin@dali.dartmouth.edu",
      firstName: "Admin",
      lastName: "User",
      daliMember: { create: {} },
    },
  });
  await prisma.adminMembership.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id },
  });
  await prisma.dALIMember.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id },
  });

  // A second reviewer so we hit the 2-per-domain minimum the lead UI enforces.
  const reviewer2 = await prisma.user.upsert({
    where: { daliEmail: "reviewer2@dali.dartmouth.edu" },
    update: {},
    create: {
      daliEmail: "reviewer2@dali.dartmouth.edu",
      firstName: "Second",
      lastName: "Reviewer",
      daliMember: { create: {} },
    },
  });
  console.log(`✓ Reviewers: admin + ${reviewer2.daliEmail}`);

  // 5. Shortform + Rubric ------------------------------------------------------
  const latestForm = await prisma.shortformVersion.findFirst({
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const formVersion = await prisma.shortformVersion.create({
    data: {
      version: (latestForm?.version ?? 0) + 1,
      questions: [
        {
          key: "q1",
          type: "textarea",
          required: true,
          data: {
            label: "Why do you want to convert from your intern role to full-time?",
          },
        },
        {
          key: "q2",
          type: "textarea",
          required: true,
          data: { label: "What domain skills did you grow most during the intern term?" },
        },
      ] as any,
      createdById: admin.id,
    },
  });

  const rubric = await prisma.rubric.upsert({
    where: { id: "demo-itf-rubric" },
    update: {},
    create: { id: "demo-itf-rubric", name: "InternToFull Demo Rubric" },
  });
  const rubricVersion = await prisma.rubricVersion.create({
    data: {
      rubricId: rubric.id,
      versionNumber: 1,
      criteria: [
        { key: "growth", label: "Growth during intern term", maxScore: 5 },
        { key: "fit", label: "Fit for target domain", maxScore: 5 },
      ] as any,
      createdById: admin.id,
    },
  });
  console.log(`✓ Shortform v${formVersion.version} + rubric ${rubric.name} v${rubricVersion.versionNumber}`);

  // 6. Cycle -------------------------------------------------------------------
  const closeDate = new Date(now);
  closeDate.setDate(closeDate.getDate() + 14);

  const cycle = await prisma.applicationCycle.create({
    data: {
      name: `Intern → Full ${termCode} demo`,
      cycleType: "Fellowship",
      closeDate,
      shortformVersionId: formVersion.id,
      statusUpdates: { create: { newStatus: "Draft", userId: admin.id } },
      domains: {
        create: [
          {
            domainId: engDomain.id,
            rubricVersionId: rubricVersion.id,
            isReady: true,
            reviewersPerApplication: 2,
          },
        ],
      },
    },
  });

  // Reviewers per target domain (need >=2 for the lead UI threshold).
  for (const userId of [admin.id, reviewer2.id]) {
    await prisma.cycleReviewer.upsert({
      where: {
        userId_applicationCycleId_domainId: {
          userId,
          applicationCycleId: cycle.id,
          domainId: engDomain.id,
        },
      },
      update: {},
      create: {
        userId,
        applicationCycleId: cycle.id,
        domainId: engDomain.id,
      },
    });
  }

  // Move the cycle to Open so the applicant route renders the form.
  await prisma.applicationCycleStatusUpdate.create({
    data: { applicationCycleId: cycle.id, newStatus: "Open", userId: admin.id },
  });

  // Mirror the route's notification fan-out (api.cycles.$cycleId.status.ts).
  // We're bypassing the API here, so without this the in-app notification
  // never surfaces and the intern can't see the "cycle is open" prompt.
  // Inline rather than imported because this is the only non-route caller —
  // if a second one shows up later, extract a shared helper.
  const eligibleAssignments = await prisma.projectAssignment.findMany({
    where: { termId: term.id, domain: { isInternProgram: true } },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (eligibleAssignments.length > 0) {
    const closeText = ` Apply by ${closeDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`;
    await prisma.notification.createMany({
      data: eligibleAssignments.map(({ userId }) => ({
        recipientUserId: userId,
        createdByUserId: admin.id,
        kind: "General" as const,
        title: "Intern → Full-time application is open",
        body: `${cycle.name} is accepting conversion applications.${closeText}`,
        link: "/intern-to-full",
      })),
    });
  }
  await prisma.applicationCycle.update({
    where: { id: cycle.id },
    data: { applicantsNotifiedAt: new Date() },
  });
  console.log(`✓ Notified ${eligibleAssignments.length} eligible intern(s)`);

  console.log("\n✓ InternToFull demo cycle is Open\n");
  console.log(`  Cycle:   /hiring/lead/intern-to-full-cycle/${cycle.id}`);
  console.log("  Apply:   /intern-to-full   (log in as intern@dali.dartmouth.edu via /dev-login-as)");
  console.log("  Review:  /hiring/reviewer   (log in as admin@dali.dartmouth.edu)\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
