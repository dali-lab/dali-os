import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // ── Admin user (creates forms, challenges, and cycle) ──────────────────────
  const admin = await prisma.user.upsert({
    where: { netId: "f007abc" },
    update: {},
    create: {
      netId: "f007abc",
      daliEmail: "admin@dali.dartmouth.edu",
      firstName: "Admin",
      lastName: "User",
      daliMember: { create: { daliEmail: "admin@dali.dartmouth.edu" } },
    },
  });

  // ── Domains ────────────────────────────────────────────────────────────────
  const [designDomain, engDomain, pmDomain] = await Promise.all([
    prisma.domain.upsert({
      where: { id: "domain-design" },
      update: {},
      create: { id: "domain-design", name: "Design" },
    }),
    prisma.domain.upsert({
      where: { id: "domain-eng" },
      update: {},
      create: { id: "domain-eng", name: "Engineering" },
    }),
    prisma.domain.upsert({
      where: { id: "domain-pm" },
      update: {},
      create: { id: "domain-pm", name: "Product" },
    }),
  ]);

  // ── Challenges ─────────────────────────────────────────────────────────────
  const [designChallenge, engChallenge, pmChallenge] = await Promise.all([
    prisma.challenge.upsert({
      where: { id: "challenge-design" },
      update: {},
      create: { id: "challenge-design", name: "Design Challenge" },
    }),
    prisma.challenge.upsert({
      where: { id: "challenge-eng" },
      update: {},
      create: { id: "challenge-eng", name: "Engineering Challenge" },
    }),
    prisma.challenge.upsert({
      where: { id: "challenge-pm" },
      update: {},
      create: { id: "challenge-pm", name: "Product Challenge" },
    }),
  ]);

  // ── Challenge versions (immutable snapshots) ───────────────────────────────
  const designQuestions = [
    {
      key: "dq-00000000-0000-0000-0000-000000000001",
      type: "text",
      required: true,
      data: {
        label: "Walk us through your design process for a recent project.",
      },
    },
    {
      key: "dq-00000000-0000-0000-0000-000000000002",
      type: "text",
      required: true,
      data: {
        label: "Share a link to your portfolio or a sample of your work.",
      },
    },
    {
      key: "dq-00000000-0000-0000-0000-000000000003",
      type: "text",
      required: false,
      data: {
        label:
          "Describe a time when user research changed the direction of a design. What did you learn?",
      },
    },
  ];

  const engQuestions = [
    {
      key: "eq-00000000-0000-0000-0000-000000000001",
      type: "text",
      required: true,
      data: {
        label:
          "Describe a technical challenge you solved and how you approached it.",
      },
    },
    {
      key: "eq-00000000-0000-0000-0000-000000000002",
      type: "text",
      required: true,
      data: {
        label:
          "Link to a GitHub repo or code sample you're proud of. What would you change now?",
      },
    },
    {
      key: "eq-00000000-0000-0000-0000-000000000003",
      type: "text",
      required: false,
      data: {
        label:
          "What's a technology or concept you've been learning recently, and why does it interest you?",
      },
    },
  ];

  const pmQuestions = [
    {
      key: "pq-00000000-0000-0000-0000-000000000001",
      type: "text",
      required: true,
      data: {
        label:
          "Pick a product you use every day. What's one thing you'd improve and how would you validate that change?",
      },
    },
    {
      key: "pq-00000000-0000-0000-0000-000000000002",
      type: "text",
      required: true,
      data: {
        label:
          "Describe a time you had to make a decision with limited information. What happened?",
      },
    },
  ];

  const engQuestionsV2 = [
    {
      key: "eq2-00000000-0000-0000-0000-000000000001",
      type: "text",
      required: true,
      data: { label: "Walk us through a system you designed from scratch. What tradeoffs did you make?" },
    },
    {
      key: "eq2-00000000-0000-0000-0000-000000000002",
      type: "text",
      required: true,
      data: { label: "Link to a project you built. What's one thing you'd do differently today?" },
    },
    {
      key: "eq2-00000000-0000-0000-0000-000000000003",
      type: "text",
      required: true,
      data: { label: "Describe a bug that took you a long time to track down. How did you find it?" },
    },
    {
      key: "eq2-00000000-0000-0000-0000-000000000004",
      type: "text",
      required: false,
      data: { label: "What's a technology or tool you've been exploring lately?" },
    },
  ];

  const [designCv, engCv, engCv2, pmCv] = await Promise.all([
    prisma.challengeVersion.upsert({
      where: { id: "cv-design" },
      update: {},
      create: {
        id: "cv-design",
        questions: designQuestions,
        challengeId: designChallenge.id,
        domainId: designDomain.id,
        createdById: admin.id,
      },
    }),
    prisma.challengeVersion.upsert({
      where: { id: "cv-eng" },
      update: {},
      create: {
        id: "cv-eng",
        questions: engQuestions,
        challengeId: engChallenge.id,
        domainId: engDomain.id,
        createdById: admin.id,
      },
    }),
    prisma.challengeVersion.upsert({
      where: { id: "cv-eng-v2" },
      update: {},
      create: {
        id: "cv-eng-v2",
        questions: engQuestionsV2,
        challengeId: engChallenge.id,
        domainId: engDomain.id,
        createdById: admin.id,
      },
    }),
    prisma.challengeVersion.upsert({
      where: { id: "cv-pm" },
      update: {},
      create: {
        id: "cv-pm",
        questions: pmQuestions,
        challengeId: pmChallenge.id,
        domainId: pmDomain.id,
        createdById: admin.id,
      },
    }),
  ]);

  // ── Application form + version ─────────────────────────────────────────────
  const form = await prisma.applicationForm.upsert({
    where: { id: "form-main" },
    update: {},
    create: { id: "form-main" },
  });

  const formQuestions = [
    {
      key: "fq-00000000-0000-0000-0000-000000000001",
      type: "text",
      required: true,
      data: { label: "Why do you want to join DALI?" },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000002",
      type: "text",
      required: true,
      data: { label: "What year are you, and what are you studying?" },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000003",
      type: "text",
      required: false,
      data: {
        label: "Is there anything else you'd like us to know about you?",
      },
    },
  ];

  const formVersion = await prisma.applicationFormVersion.upsert({
    where: { id: "fv-main-v1" },
    update: {},
    create: {
      id: "fv-main-v1",
      questions: formQuestions,
      applicationFormId: form.id,
      createdById: admin.id,
    },
  });

  // ── Application cycle: Fall 2026 ───────────────────────────────────────────
  const cycle = await prisma.applicationCycle.upsert({
    where: { id: "cycle-fall-2026" },
    update: {},
    create: {
      id: "cycle-fall-2026",
      name: "Fall 2026",
      domains: {
        create: [
          { domainId: designDomain.id },
          { domainId: engDomain.id },
          { domainId: pmDomain.id },
        ],
      },
      challengeVersions: {
        create: [
          { challengeVersionId: designCv.id },
          { challengeVersionId: engCv.id },
          { challengeVersionId: pmCv.id },
        ],
      },
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: admin.id },
          { newStatus: "Open", userId: admin.id },
          { newStatus: "Closed", userId: admin.id },
        ],
      },
    },
  });

  // ── Applicant users ────────────────────────────────────────────────────────
  const [alice, bob, carol] = await Promise.all([
    prisma.user.upsert({
      where: { netId: "f007al1" },
      update: {},
      create: {
        netId: "f007al1",
        dartmouthEmail: "alice.m.johnson.26@dartmouth.edu",
        firstName: "Alice",
        lastName: "Johnson",
      },
    }),
    prisma.user.upsert({
      where: { netId: "f007bo2" },
      update: {},
      create: {
        netId: "f007bo2",
        dartmouthEmail: "bob.k.chen.27@dartmouth.edu",
        firstName: "Bob",
        lastName: "Chen",
      },
    }),
    prisma.user.upsert({
      where: { netId: "f007ca3" },
      update: {},
      create: {
        netId: "f007ca3",
        dartmouthEmail: "carol.r.patel.26@dartmouth.edu",
        firstName: "Carol",
        lastName: "Patel",
      },
    }),
  ]);

  // ── Applications ───────────────────────────────────────────────────────────
  // Alice: submitted Engineering application
  const aliceApp = await prisma.application.upsert({
    where: { id: "app-alice" },
    update: {},
    create: {
      id: "app-alice",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "DALI's focus on real-world impact and cross-functional teams is exactly the environment I want to grow in.",
        "fq-00000000-0000-0000-0000-000000000002":
          "Sophomore, Computer Science",
        "fq-00000000-0000-0000-0000-000000000003": "I'm also a TA for CS 10.",
      },
      userId: alice.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: formVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: alice.id },
          { newStatus: "Submitted", userId: alice.id },
        ],
      },
      domainApplications: {
        create: [
          {
            challengeVersionId: engCv.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001":
                "I built a distributed rate-limiter for my systems class using a token-bucket algorithm. The hardest part was handling clock skew across nodes.",
              "eq-00000000-0000-0000-0000-000000000002":
                "github.com/alice/ratelimiter — I'd add better observability hooks now.",
              "eq-00000000-0000-0000-0000-000000000003":
                "I've been learning Rust because I want to understand memory safety at a deeper level than C++.",
            },
          },
        ],
      },
    },
  });

  // Bob: submitted Design + Product applications
  const bobApp = await prisma.application.upsert({
    where: { id: "app-bob" },
    update: {},
    create: {
      id: "app-bob",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "I've admired DALI projects on campus for two years and want to contribute to products that reach real users.",
        "fq-00000000-0000-0000-0000-000000000002":
          "Junior, Studio Art + Government",
      },
      userId: bob.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: formVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: bob.id },
          { newStatus: "Submitted", userId: bob.id },
        ],
      },
      domainApplications: {
        create: [
          {
            challengeVersionId: designCv.id,
            answers: {
              "dq-00000000-0000-0000-0000-000000000001":
                "I start with stakeholder interviews, then low-fi sketches before moving to Figma.",
              "dq-00000000-0000-0000-0000-000000000002":
                "figma.com/file/bob-portfolio",
              "dq-00000000-0000-0000-0000-000000000003":
                "User testing revealed our icon set was culturally ambiguous for international students, so we switched to labelled buttons.",
            },
          },
          {
            challengeVersionId: pmCv.id,
            answers: {
              "pq-00000000-0000-0000-0000-000000000001":
                "Notion's sidebar navigation is overwhelming. I'd introduce a 'focus mode' that hides unused sections, then A/B test retention after 30 days.",
              "pq-00000000-0000-0000-0000-000000000002":
                "During a hackathon I had to pick a tech stack with no prior data. I time-boxed spikes to 20 minutes each and chose based on team familiarity.",
            },
          },
        ],
      },
    },
  });

  // Carol: draft Engineering application (not yet submitted)
  const carolApp = await prisma.application.upsert({
    where: { id: "app-carol" },
    update: {},
    create: {
      id: "app-carol",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "I want to work on products with real impact.",
        "fq-00000000-0000-0000-0000-000000000002": "Senior, Computer Science",
      },
      userId: carol.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: formVersion.id,
      statusUpdates: {
        create: [{ newStatus: "Draft", userId: carol.id }],
      },
      domainApplications: {
        create: [
          {
            challengeVersionId: engCv.id,
            answers: {},
          },
        ],
      },
    },
  });

  // ── Domain lead user ──────────────────────────────────────────────────────
  const engLead = await prisma.user.upsert({
    where: { netId: "f007el1" },
    update: {},
    create: {
      netId: "f007el1",
      daliEmail: "eng.lead@dali.dartmouth.edu",
      firstName: "Engineering",
      lastName: "Lead",
      daliMember: { create: { daliEmail: "eng.lead@dali.dartmouth.edu" } },
    },
  });

  const engLeadMember = await prisma.dALIMember.findUniqueOrThrow({
    where: { daliEmail: "eng.lead@dali.dartmouth.edu" },
  });

  await prisma.domainLeadAssignment.upsert({
    where: { id: "dla-eng-lead" },
    update: {},
    create: {
      id: "dla-eng-lead",
      memberId: engLeadMember.id,
      domainId: engDomain.id,
    },
  });

  console.log("Seed complete:");
  console.log(`  Admin: ${admin.firstName} ${admin.lastName}`);
<<<<<<< feature/hiring-cycle-dashboard
  console.log(`  Domains: ${[designDomain, engDomain, pmDomain].map((d) => d.name).join(", ")}`);
  console.log(`  Cycle: ${cycle.name} (Closed)`);
=======
  console.log(
    `  Domains: ${[designDomain, engDomain, pmDomain].map((d) => d.name).join(", ")}`,
  );
  console.log(`  Cycle: ${cycle.name}`);
>>>>>>> dev
  console.log(
    `  Applications: ${aliceApp.id} (submitted), ${bobApp.id} (submitted), ${carolApp.id} (draft)`,
  );
  console.log(`  Domain lead: ${engLead.firstName} ${engLead.lastName} → Engineering`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
