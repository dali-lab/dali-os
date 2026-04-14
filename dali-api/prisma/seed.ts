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

  // ── Rubrics ────────────────────────────────────────────────────────────────

  // General rubric (attached to the main form version)
  const generalRubric = await prisma.rubric.upsert({
    where: { id: "rubric-general" },
    update: {},
    create: { id: "rubric-general", name: "General Application Rubric", domainId: null },
  });

  const generalRubricVersion = await prisma.rubricVersion.upsert({
    where: { id: "rv-general-v1" },
    update: {},
    create: {
      id: "rv-general-v1",
      rubricId: generalRubric.id,
      versionNumber: 1,
      createdById: admin.id,
      applicationFormVersionId: "fv-main-v1",
      criteria: [
        { key: "rc-motivation", label: "Motivation & Fit", description: "Does the applicant articulate why they want to join DALI and what they'll contribute?", maxScore: 5 },
        { key: "rc-communication", label: "Communication", description: "Are responses clear, specific, and well-structured?", maxScore: 5 },
        { key: "rc-self-awareness", label: "Self-Awareness", description: "Does the applicant demonstrate honest reflection about their strengths and growth areas?", maxScore: 5 },
      ],
    },
  });

  // Engineering rubric
  const engRubric = await prisma.rubric.upsert({
    where: { id: "rubric-eng" },
    update: {},
    create: { id: "rubric-eng", name: "Engineering Rubric", domainId: engDomain.id },
  });

  const engRubricVersion = await prisma.rubricVersion.upsert({
    where: { id: "rv-eng-v1" },
    update: {},
    create: {
      id: "rv-eng-v1",
      rubricId: engRubric.id,
      versionNumber: 1,
      createdById: admin.id,
      criteria: [
        { key: "rc-technical-depth", label: "Technical Depth", description: "Does the applicant demonstrate solid understanding of the concepts behind their work?", maxScore: 5 },
        { key: "rc-problem-solving", label: "Problem Solving", description: "Is their approach to challenges systematic and thoughtful?", maxScore: 5 },
        { key: "rc-code-quality", label: "Code Quality & Craft", description: "Do their examples show attention to maintainability, correctness, and design?", maxScore: 5 },
        { key: "rc-curiosity", label: "Curiosity & Growth", description: "Is there evidence of self-directed learning and intellectual curiosity?", maxScore: 5 },
      ],
    },
  });

  // Attach engineering rubric to both eng challenge versions
  await Promise.all([
    prisma.challengeVersion.update({
      where: { id: "cv-eng" },
      data: { rubricVersionId: engRubricVersion.id },
    }),
    prisma.challengeVersion.update({
      where: { id: "cv-eng-v2" },
      data: { rubricVersionId: engRubricVersion.id },
    }),
  ]);

  // Product rubric
  const pmRubric = await prisma.rubric.upsert({
    where: { id: "rubric-pm" },
    update: {},
    create: { id: "rubric-pm", name: "Product Rubric", domainId: pmDomain.id },
  });

  const pmRubricVersion = await prisma.rubricVersion.upsert({
    where: { id: "rv-pm-v1" },
    update: {},
    create: {
      id: "rv-pm-v1",
      rubricId: pmRubric.id,
      versionNumber: 1,
      createdById: admin.id,
      criteria: [
        { key: "rc-product-thinking", label: "Product Thinking", description: "Does the applicant show structured thinking about user needs, tradeoffs, and impact?", maxScore: 5 },
        { key: "rc-decision-making", label: "Decision Making", description: "Can they make and justify decisions under uncertainty?", maxScore: 5 },
        { key: "rc-user-empathy", label: "User Empathy", description: "Do their answers center on real user problems rather than features?", maxScore: 5 },
      ],
    },
  });

  // Attach product rubric to pm challenge version
  await prisma.challengeVersion.update({
    where: { id: "cv-pm" },
    data: { rubricVersionId: pmRubricVersion.id },
  });

  // ── Application cycle: Fall 2026 ───────────────────────────────────────────
  // Status updates use explicit, ascending createdAt values so latest-status
  // queries (`orderBy: { createdAt: "desc" }`) are deterministic. Without
  // explicit timestamps prisma stamps every row in the same nested create with
  // the same instant and ties resolve nondeterministically.
  const seedNow = Date.now();
  const ts = (offsetMs: number) => new Date(seedNow + offsetMs);
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
          { newStatus: "Draft", userId: admin.id, createdAt: ts(-3000) },
          { newStatus: "Open", userId: admin.id, createdAt: ts(-2000) },
          { newStatus: "Closed", userId: admin.id, createdAt: ts(-1000) },
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
          { newStatus: "Draft", userId: alice.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: alice.id, createdAt: ts(-1000) },
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
          { newStatus: "Draft", userId: bob.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: bob.id, createdAt: ts(-1000) },
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

  // ── Application cycle: Winter 2028 (Open) ─────────────────────────────────
  const cycle2028 = await prisma.applicationCycle.upsert({
    where: { id: "cycle-winter-2028" },
    update: {},
    create: {
      id: "cycle-winter-2028",
      name: "Winter 2028",
      formVersionId: formVersion.id,
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
          { challengeVersionId: engCv2.id },
          { challengeVersionId: pmCv.id },
        ],
      },
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: admin.id, createdAt: ts(-2000) },
          { newStatus: "Open", userId: admin.id, createdAt: ts(-1000) },
        ],
      },
    },
  });

  // Dana: submitted Engineering application in Winter 2028
  const dana = await prisma.user.upsert({
    where: { netId: "f007da4" },
    update: {},
    create: {
      netId: "f007da4",
      dartmouthEmail: "dana.l.kim.28@dartmouth.edu",
      firstName: "Dana",
      lastName: "Kim",
    },
  });

  await prisma.application.upsert({
    where: { id: "app-dana" },
    update: {},
    create: {
      id: "app-dana",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "I want to build things that matter. DALI's track record of shipping real products is why I'm applying.",
        "fq-00000000-0000-0000-0000-000000000002":
          "Freshman, Computer Science",
        "fq-00000000-0000-0000-0000-000000000003":
          "I competed in ICPC regionals this fall and placed in the top 10.",
      },
      userId: dana.id,
      applicationCycleId: cycle2028.id,
      applicationFormVersionId: formVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: dana.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: dana.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            challengeVersionId: engCv2.id,
            answers: {
              "eq2-00000000-0000-0000-0000-000000000001":
                "I built a real-time collaborative code editor using CRDTs. The main tradeoff was consistency vs. latency — I chose eventual consistency to keep the UI snappy.",
              "eq2-00000000-0000-0000-0000-000000000002":
                "github.com/dana/collab-editor — I'd use operational transforms instead of raw CRDTs if I did it again; the merge logic got gnarly.",
              "eq2-00000000-0000-0000-0000-000000000003":
                "A race condition in my websocket handler that only appeared under high load. Found it by adding structured logging and replaying prod traffic locally.",
              "eq2-00000000-0000-0000-0000-000000000004":
                "WebAssembly — I want to understand how browser-native performance boundaries actually work.",
            },
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

  // ── Interview scheduling seed ──────────────────────────────────────────────

  const today = new Date();
  const interviewStart = new Date(today);
  interviewStart.setDate(today.getDate() + 1);
  interviewStart.setHours(0, 0, 0, 0);
  const interviewEnd = new Date(today);
  interviewEnd.setDate(today.getDate() + 14);
  interviewEnd.setHours(23, 59, 59, 999);

  await prisma.interviewConfig.upsert({
    where: { applicationCycleId: cycle.id },
    update: {
      slotDurationMinutes: 30,
      bufferMinutes: 15,
      dayStartHour: 9,
      dayEndHour: 18,
      interviewStartDate: interviewStart,
      interviewEndDate: interviewEnd,
      timezone: "America/New_York",
    },
    create: {
      applicationCycleId: cycle.id,
      slotDurationMinutes: 30,
      bufferMinutes: 15,
      dayStartHour: 9,
      dayEndHour: 18,
      interviewStartDate: interviewStart,
      interviewEndDate: interviewEnd,
      timezone: "America/New_York",
    },
  });

  const reviewerData = [
    { netId: "rev001", email: "reviewer1@dali.dartmouth.edu", first: "Riley", last: "Engineer", domainId: engDomain.id },
    { netId: "rev002", email: "reviewer2@dali.dartmouth.edu", first: "Dana", last: "Designer", domainId: designDomain.id },
    { netId: "rev003", email: "reviewer3@dali.dartmouth.edu", first: "Pat", last: "Product", domainId: pmDomain.id },
  ];

  for (const r of reviewerData) {
    const user = await prisma.user.upsert({
      where: { netId: r.netId },
      update: {},
      create: {
        netId: r.netId,
        daliEmail: r.email,
        firstName: r.first,
        lastName: r.last,
        daliMember: { create: { daliEmail: r.email } },
      },
      include: { daliMember: true },
    });

    if (!user.daliMember) continue;

    await prisma.cycleReviewer.upsert({
      where: { daliMemberId_applicationCycleId: { daliMemberId: user.daliMember.id, applicationCycleId: cycle.id } },
      update: {},
      create: {
        daliMemberId: user.daliMember.id,
        applicationCycleId: cycle.id,
        domainId: r.domainId,
        isLead: false,
      },
    });
  }

  // ── Reviewer availability ────────────────────────────────────────────────
  const allReviewers = await prisma.cycleReviewer.findMany({
    where: { applicationCycleId: cycle.id },
  });

  const availabilityWindows: { startTime: Date; endTime: Date }[] = [];
  const cursor = new Date(interviewStart);
  while (cursor <= interviewEnd) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const start = new Date(cursor);
      start.setUTCHours(14, 0, 0, 0);
      const end = new Date(cursor);
      end.setUTCHours(16, 0, 0, 0);
      availabilityWindows.push({ startTime: start, endTime: end });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const reviewer of allReviewers) {
    await prisma.reviewerAvailability.deleteMany({
      where: { cycleReviewerId: reviewer.id },
    });
    for (const w of availabilityWindows) {
      await prisma.reviewerAvailability.create({
        data: { cycleReviewerId: reviewer.id, startTime: w.startTime, endTime: w.endTime },
      });
    }
  }

  console.log(`  Rubrics: ${generalRubric.name}, ${engRubric.name}, ${pmRubric.name}`);
  console.log("Seed complete:");
  console.log(`  Admin: ${admin.firstName} ${admin.lastName}`);
  console.log(`  Domains: ${[designDomain, engDomain, pmDomain].map((d) => d.name).join(", ")}`);
  console.log(`  Cycle: ${cycle.name} (Closed)`);
  console.log(`  Cycle: ${cycle2028.name} (Open)`);
  console.log(
    `  Applications: ${aliceApp.id} (submitted), ${bobApp.id} (submitted), ${carolApp.id} (draft)`,
  );
  console.log(`  Application: app-dana (submitted, Winter 2028)`);
  console.log(`  Domain lead: ${engLead.firstName} ${engLead.lastName} → Engineering`);
  console.log(
    `  Interview config + 3 reviewers (each with ${availabilityWindows.length} availability blocks) seeded for cycle ${cycle.id}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
