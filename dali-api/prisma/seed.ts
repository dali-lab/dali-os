import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // ── Admin user (creates forms, challenges, and cycle) ──────────────────────
  const admin = await prisma.user.upsert({
    where: { email: "admin@dali.dartmouth.edu" },
    update: { firstName: "Admin", lastName: "User", name: "Admin User" },
    create: {
      email: "admin@dali.dartmouth.edu",
      name: "Admin User",
      firstName: "Admin",
      lastName: "User",
      daliMember: {
        create: {
          daliEmail: "admin@dali.dartmouth.edu",
          firstName: "Admin",
          lastName: "User",
          roles: ["Admin"],
        },
      },
    },
  });
  await prisma.dALIMember.update({
    where: { daliEmail: "admin@dali.dartmouth.edu" },
    data: { firstName: "Admin", lastName: "User", roles: ["Admin"] },
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
      type: "figma_url",
      required: true,
      data: {
        label: "Share a link to your Figma portfolio or a sample of your work.",
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
      type: "github_url",
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
      type: "github_url",
      required: true,
      data: { label: "Link to a GitHub repo you built. What's one thing you'd do differently today?" },
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
  // ── General application form (as a Challenge with domainId: null) ──────────
  const generalFormChallenge = await prisma.challenge.upsert({
    where: { id: "challenge-general-form" },
    update: {},
    create: { id: "challenge-general-form", name: "General Application Form" },
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

  const generalFormVersion = await prisma.challengeVersion.upsert({
    where: { id: "cv-general-form-v1" },
    update: {},
    create: {
      id: "cv-general-form-v1",
      questions: formQuestions,
      challengeId: generalFormChallenge.id,
      domainId: null,
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

  await prisma.rubricVersion.upsert({
    where: { id: "rv-general-v1" },
    update: {},
    create: {
      id: "rv-general-v1",
      rubricId: generalRubric.id,
      versionNumber: 1,
      createdById: admin.id,
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

  // Design rubric
  const designRubric = await prisma.rubric.upsert({
    where: { id: "rubric-design" },
    update: {},
    create: { id: "rubric-design", name: "Design Rubric", domainId: designDomain.id },
  });

  const designRubricVersion = await prisma.rubricVersion.upsert({
    where: { id: "rv-design-v1" },
    update: {},
    create: {
      id: "rv-design-v1",
      rubricId: designRubric.id,
      versionNumber: 1,
      createdById: admin.id,
      criteria: [
        { key: "rc-visual-craft", label: "Visual Craft", description: "Does the applicant demonstrate strong visual design skills and attention to detail?", maxScore: 5 },
        { key: "rc-design-process", label: "Design Process", description: "Is there evidence of a thoughtful, user-centered design process?", maxScore: 5 },
        { key: "rc-systems-thinking", label: "Systems Thinking", description: "Can the applicant think holistically about design systems and consistency?", maxScore: 5 },
        { key: "rc-iteration", label: "Iteration & Feedback", description: "Does the applicant show willingness to iterate based on feedback and testing?", maxScore: 5 },
      ],
    },
  });

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

  // ── Application cycle: Fall 2026 ───────────────────────────────────────────
  const seedNow = Date.now();
  const ts = (offsetMs: number) => new Date(seedNow + offsetMs);
  const cycle = await prisma.applicationCycle.upsert({
    where: { id: "cycle-fall-2026" },
    update: {},
    create: {
      id: "cycle-fall-2026",
      name: "Fall 2026",
      closeDate: new Date("2026-09-30T23:59:59Z"),
      generalRubricVersionId: "rv-general-v1",
      domains: {
        create: [
          { domainId: designDomain.id, rubricVersionId: designRubricVersion.id },
          { domainId: engDomain.id, rubricVersionId: engRubricVersion.id },
          { domainId: pmDomain.id, rubricVersionId: pmRubricVersion.id },
        ],
      },
      challengeVersions: {
        create: [
          { challengeVersionId: generalFormVersion.id },
          { challengeVersionId: designCv.id },
          { challengeVersionId: engCv.id },
          { challengeVersionId: pmCv.id },
        ],
      },
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: admin.id, createdAt: ts(-3000) },
          { newStatus: "Open", userId: admin.id, createdAt: ts(-2000) },
          { newStatus: "UnderReview", userId: admin.id, createdAt: ts(-1000) },
        ],
      },
    },
  });

  // ── Applicant users ────────────────────────────────────────────────────────
  const [alice, bob, carol] = await Promise.all([
    prisma.user.upsert({
      where: { email: "f007al1@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007al1",
        email: "alice.m.johnson.26@dartmouth.edu",
        name: "Alice Johnson",
        firstName: "Alice",
        lastName: "Johnson",
      },
    }),
    prisma.user.upsert({
      where: { email: "f007bo2@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007bo2",
        email: "bob.k.chen.27@dartmouth.edu",
        name: "Bob Chen",
        firstName: "Bob",
        lastName: "Chen",
      },
    }),
    prisma.user.upsert({
      where: { email: "f007ca3@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007ca3",
        email: "carol.r.patel.26@dartmouth.edu",
        name: "Carol Patel",
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
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: alice.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: alice.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-alice-eng",
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
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: bob.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: bob.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-bob-design",
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
            id: "da-bob-pm",
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
  await prisma.application.upsert({
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
      generalChallengeVersionId: generalFormVersion.id,
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

  // ── Additional Fall 2026 applicants ───────────────────────────────────────
  // Diego (Eng), Eve (Design), Felix (Product), Grace (Eng), Harper (Design),
  // Ivan (Eng), Jade (Design), Kenji (Eng), Leo (Eng) — last four need
  // reviewer assignment (submitted, no reviews yet).
  const [diego, eve, felix, grace, harper, ivan, jade, kenji, leo] = await Promise.all([
    prisma.user.upsert({
      where: { email: "f007di4@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007di4",
        email: "diego.s.rivera.26@dartmouth.edu",
        name: "Diego Rivera",
        firstName: "Diego",
        lastName: "Rivera",
      },
    }),
    prisma.user.upsert({
      where: { email: "f007ev5@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007ev5",
        email: "eve.m.park.27@dartmouth.edu",
        name: "Eve Park",
        firstName: "Eve",
        lastName: "Park",
      },
    }),
    prisma.user.upsert({
      where: { email: "f007fe6@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007fe6",
        email: "felix.t.nguyen.26@dartmouth.edu",
        name: "Felix Nguyen",
        firstName: "Felix",
        lastName: "Nguyen",
      },
    }),
    prisma.user.upsert({
      where: { email: "f007gr7@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007gr7",
        email: "grace.l.okafor.28@dartmouth.edu",
        name: "Grace Okafor",
        firstName: "Grace",
        lastName: "Okafor",
      },
    }),
    prisma.user.upsert({
      where: { email: "f007ha8@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007ha8",
        email: "harper.j.sato.27@dartmouth.edu",
        name: "Harper Sato",
        firstName: "Harper",
        lastName: "Sato",
      },
    }),
    prisma.user.upsert({
      where: { email: "f007iv9@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007iv9",
        email: "ivan.d.kozlov.28@dartmouth.edu",
        name: "Ivan Kozlov",
        firstName: "Ivan",
        lastName: "Kozlov",
      },
    }),
    prisma.user.upsert({
      where: { email: "f007ja0@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007ja0",
        email: "jade.r.montgomery.27@dartmouth.edu",
        name: "Jade Montgomery",
        firstName: "Jade",
        lastName: "Montgomery",
      },
    }),
    prisma.user.upsert({
      where: { email: "f007ke1@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007ke1",
        email: "kenji.h.yamada.28@dartmouth.edu",
        name: "Kenji Yamada",
        firstName: "Kenji",
        lastName: "Yamada",
      },
    }),
    prisma.user.upsert({
      where: { email: "f007le2@dartmouth.edu" },
      update: {},
      create: {
        netId: "f007le2",
        email: "leo.p.brennan.26@dartmouth.edu",
        name: "Leo Brennan",
        firstName: "Leo",
        lastName: "Brennan",
      },
    }),
  ]);

  // Diego: submitted Engineering application, strong candidate
  await prisma.application.upsert({
    where: { id: "app-diego" },
    update: {},
    create: {
      id: "app-diego",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "DALI blends research-quality engineering with products students actually use — that's rare and what I want to be part of.",
        "fq-00000000-0000-0000-0000-000000000002": "Junior, Computer Science + Math",
      },
      userId: diego.id,
      applicationCycleId: cycle.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: diego.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: diego.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-diego-eng",
            challengeVersionId: engCv.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001":
                "I wrote a type-checker for a small functional language as a final project. Unification was the hard part — I ended up implementing Hindley-Milner after two weeks of painful debugging.",
              "eq-00000000-0000-0000-0000-000000000002":
                "github.com/diego/hm-checker — I'd split the unifier into its own module and add property-based tests.",
              "eq-00000000-0000-0000-0000-000000000003":
                "I've been reading about deterministic simulation testing in databases. The idea that you can replay exact schedules to debug concurrency bugs is wild.",
            },
          },
        ],
      },
    },
  });

  // Eve: submitted Design application, strong candidate
  await prisma.application.upsert({
    where: { id: "app-eve" },
    update: {},
    create: {
      id: "app-eve",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "I want to design for a team that ships to real users and iterates — DALI projects do both.",
        "fq-00000000-0000-0000-0000-000000000002": "Sophomore, Studio Art + Cognitive Science",
      },
      userId: eve.id,
      applicationCycleId: cycle.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: eve.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: eve.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-eve-design",
            challengeVersionId: designCv.id,
            answers: {
              "dq-00000000-0000-0000-0000-000000000001":
                "I interview three or four actual users before touching Figma. My first wireframes are always ugly and paper — it saves tons of time downstream.",
              "dq-00000000-0000-0000-0000-000000000002":
                "evepark.design — recent case study on a library book-return kiosk.",
              "dq-00000000-0000-0000-0000-000000000003":
                "We were convinced freshmen wanted a map view for our dining app, but testing showed they just wanted a list sorted by wait time. We cut the map.",
            },
          },
        ],
      },
    },
  });

  // Felix: submitted Product application
  await prisma.application.upsert({
    where: { id: "app-felix" },
    update: {},
    create: {
      id: "app-felix",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "I'm drawn to DALI's combination of real stakeholders and short feedback loops.",
        "fq-00000000-0000-0000-0000-000000000002": "Junior, Economics + Government",
      },
      userId: felix.id,
      applicationCycleId: cycle.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: felix.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: felix.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-felix-pm",
            challengeVersionId: pmCv.id,
            answers: {
              "pq-00000000-0000-0000-0000-000000000001":
                "Canvas assignment notifications are noisy and land at inconvenient times. I'd batch them into a single daily digest, preserving only 'grade posted' as real-time.",
              "pq-00000000-0000-0000-0000-000000000002":
                "Running a student org's budget, I had to cut 30% mid-semester. I built a priority matrix with the exec team and used it to defend every line in the meeting.",
            },
          },
        ],
      },
    },
  });

  // Grace: submitted Engineering application — weaker answers, will be rejected
  await prisma.application.upsert({
    where: { id: "app-grace" },
    update: {},
    create: {
      id: "app-grace",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "I want to join DALI because it would look great on my resume.",
        "fq-00000000-0000-0000-0000-000000000002": "Freshman, Undeclared",
      },
      userId: grace.id,
      applicationCycleId: cycle.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: grace.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: grace.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-grace-eng",
            challengeVersionId: engCv.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001":
                "I took CS 1 and built a calculator.",
              "eq-00000000-0000-0000-0000-000000000002":
                "No public repos yet.",
              "eq-00000000-0000-0000-0000-000000000003":
                "I'm interested in AI.",
            },
          },
        ],
      },
    },
  });

  // Harper: submitted Design application — still mid-review (reviews not all submitted)
  await prisma.application.upsert({
    where: { id: "app-harper" },
    update: {},
    create: {
      id: "app-harper",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "I've followed DALI term showcases for a year and the breadth of projects is what drew me in.",
        "fq-00000000-0000-0000-0000-000000000002": "Sophomore, Film & Media Studies",
      },
      userId: harper.id,
      applicationCycleId: cycle.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: harper.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: harper.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-harper-design",
            challengeVersionId: designCv.id,
            answers: {
              "dq-00000000-0000-0000-0000-000000000001":
                "I start from constraints — who, where, what device — and let form follow. I sketch in Procreate before any high-fidelity work.",
              "dq-00000000-0000-0000-0000-000000000002":
                "harper-sato.cargo.site",
              "dq-00000000-0000-0000-0000-000000000003":
                "A study of how film students annotated shot lists showed us margins mattered more than colors — we redesigned around whitespace.",
            },
          },
        ],
      },
    },
  });

  // Ivan: submitted Engineering application — no reviewers assigned yet
  await prisma.application.upsert({
    where: { id: "app-ivan" },
    update: {},
    create: {
      id: "app-ivan",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "I want to work on things where the deployment matters as much as the code — DALI fits that better than any student org I've seen.",
        "fq-00000000-0000-0000-0000-000000000002": "Freshman, Computer Science + Physics",
      },
      userId: ivan.id,
      applicationCycleId: cycle.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: ivan.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: ivan.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-ivan-eng",
            challengeVersionId: engCv.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001":
                "Ported a finicky build pipeline from Make to Bazel for a research group. The win was incremental builds going from 40s to 3s; the lesson was that nobody cares about Bazel's purity if the upgrade path isn't clear.",
              "eq-00000000-0000-0000-0000-000000000002":
                "github.com/ivan-k/sim-toolkit — a small numerical simulation helper. I'd replace the ad-hoc logging with structured traces now.",
              "eq-00000000-0000-0000-0000-000000000003":
                "Reading about PL design for differentiable programming — the idea that a compiler can produce gradients is still wild to me.",
            },
          },
        ],
      },
    },
  });

  // Jade: submitted Design application — no reviewers assigned yet
  await prisma.application.upsert({
    where: { id: "app-jade" },
    update: {},
    create: {
      id: "app-jade",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "DALI is the rare place where design work actually ships to real users on campus. That's what I want to be part of.",
        "fq-00000000-0000-0000-0000-000000000002": "Junior, Geography + Human-Centered Design",
      },
      userId: jade.id,
      applicationCycleId: cycle.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: jade.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: jade.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-jade-design",
            challengeVersionId: designCv.id,
            answers: {
              "dq-00000000-0000-0000-0000-000000000001":
                "I start with a short research sprint — five-minute interviews with the people who will actually use it. From there I work in Figma, but only after sketches I'm willing to throw away.",
              "dq-00000000-0000-0000-0000-000000000002":
                "jadem-design.notion.site — recent wayfinding redesign for the library.",
              "dq-00000000-0000-0000-0000-000000000003":
                "We assumed users wanted dark mode by default on a tool used mostly in bright outdoor light. Testing with field researchers showed the exact opposite — high-contrast light mode was unreadable without the blue-light filter.",
            },
          },
        ],
      },
    },
  });

  // Kenji: submitted Engineering application — no reviewers assigned yet
  await prisma.application.upsert({
    where: { id: "app-kenji" },
    update: {},
    create: {
      id: "app-kenji",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "I've contributed to a few open-source React libraries and want to work somewhere the feedback loop from code to user is this tight.",
        "fq-00000000-0000-0000-0000-000000000002": "Freshman, Computer Science",
      },
      userId: kenji.id,
      applicationCycleId: cycle.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: kenji.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: kenji.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-kenji-eng",
            challengeVersionId: engCv.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001":
                "Wrote a small virtual-list component for my personal blog because the existing libraries didn't handle variable-height rows well. Chunked measurement with a ResizeObserver turned out to be the key.",
              "eq-00000000-0000-0000-0000-000000000002":
                "github.com/kenjiy/virtual-list-lite — I'd pull the measurement cache out into a reusable hook.",
              "eq-00000000-0000-0000-0000-000000000003":
                "WebGPU shader toolchains. It feels like we're a few years away from shader code being portable in the way JavaScript is.",
            },
          },
        ],
      },
    },
  });

  // Leo: submitted Engineering application — no reviewers assigned yet
  await prisma.application.upsert({
    where: { id: "app-leo" },
    update: {},
    create: {
      id: "app-leo",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001":
          "I came to Dartmouth planning to do pure math and ended up loving infrastructure work. DALI's mix of research and shipping is exactly what I'm looking for.",
        "fq-00000000-0000-0000-0000-000000000002": "Senior, Math + Computer Science",
      },
      userId: leo.id,
      applicationCycleId: cycle.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: leo.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: leo.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            id: "da-leo-eng",
            challengeVersionId: engCv.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001":
                "Automated a flaky CI matrix for a research lab — the fix wasn't code, it was figuring out which failures were environment-dependent vs. real regressions and quarantining the first set behind a retry.",
              "eq-00000000-0000-0000-0000-000000000002":
                "github.com/leo-b/tidy-ci — scripts to triage CI logs. Would rewrite it in Rust now that the log corpus has grown.",
              "eq-00000000-0000-0000-0000-000000000003":
                "Linear types. Every time I think I understand them I find a new edge case that reframes what memory safety can mean.",
            },
          },
        ],
      },
    },
  });

  // ── Application cycle: Winter 2028 (Draft) ────────────────────────────────
  const cycle2028 = await prisma.applicationCycle.upsert({
    where: { id: "cycle-winter-2028" },
    update: {},
    create: {
      id: "cycle-winter-2028",
      name: "Winter 2028",
      domains: {
        create: [
          { domainId: designDomain.id },
          { domainId: engDomain.id },
          { domainId: pmDomain.id },
        ],
      },
      challengeVersions: {
        create: [
          { challengeVersionId: generalFormVersion.id },
          { challengeVersionId: designCv.id },
          { challengeVersionId: engCv2.id },
          { challengeVersionId: pmCv.id },
        ],
      },
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: admin.id, createdAt: ts(-1000) },
        ],
      },
    },
  });

  // Dana: submitted Engineering application in Winter 2028
  const dana = await prisma.user.upsert({
    where: { email: "f007da4@dartmouth.edu" },
    update: {},
    create: {
      netId: "f007da4",
      email: "dana.l.kim.28@dartmouth.edu",
      name: "Dana Kim",
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
      generalChallengeVersionId: generalFormVersion.id,
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

  // ── Application cycle: Winter 2027 (Completed — past cycle) ──────────────
  // Winter 2027 is a finished cycle: every submitted applicant has a Released
  // terminal decision. This keeps the single-active-cycle invariant intact
  // (only Fall 2026 is Open/UnderReview) while still exercising the
  // "past cycle" surfaces of the UI.
  const cycleWinter2027 = await prisma.applicationCycle.upsert({
    where: { id: "cycle-winter-2027" },
    update: {},
    create: {
      id: "cycle-winter-2027",
      name: "Winter 2027",
      closeDate: new Date("2027-02-15T23:59:59Z"),
      generalRubricVersionId: "rv-general-v1",
      domains: {
        create: [
          { domainId: designDomain.id },
          { domainId: engDomain.id },
          { domainId: pmDomain.id },
        ],
      },
      challengeVersions: {
        create: [
          { challengeVersionId: generalFormVersion.id },
          { challengeVersionId: designCv.id },
          { challengeVersionId: engCv.id },
          { challengeVersionId: pmCv.id },
        ],
      },
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: admin.id, createdAt: ts(-5000) },
          { newStatus: "Open", userId: admin.id, createdAt: ts(-4000) },
        ],
      },
    },
  });

  // Idempotently advance Winter 2027 past Open → UnderReview → Completed.
  // Explicit ids so re-seeds don't pile up duplicate status rows.
  for (const [id, newStatus, offsetMs] of [
    ["acsu-w2027-underreview", "UnderReview", -3500],
    ["acsu-w2027-completed", "Completed", -3000],
  ] as const) {
    await prisma.applicationCycleStatusUpdate.upsert({
      where: { id },
      update: {},
      create: {
        id,
        applicationCycleId: cycleWinter2027.id,
        newStatus,
        userId: admin.id,
        createdAt: ts(offsetMs),
      },
    });
  }

  // ── Applicants for Winter 2027 ────────────────────────────────────────────
  const [emma, liam, sofia, noah, olivia, ethan, ava, mason] = await Promise.all([
    prisma.user.upsert({
      where: { email: "f007em5@dartmouth.edu" },
      update: {},
      create: { netId: "f007em5", email: "emma.j.torres.27@dartmouth.edu", name: "Emma Torres", firstName: "Emma", lastName: "Torres" },
    }),
    prisma.user.upsert({
      where: { email: "f007li6@dartmouth.edu" },
      update: {},
      create: { netId: "f007li6", email: "liam.t.nguyen.28@dartmouth.edu", name: "Liam Nguyen", firstName: "Liam", lastName: "Nguyen" },
    }),
    prisma.user.upsert({
      where: { email: "f007so7@dartmouth.edu" },
      update: {},
      create: { netId: "f007so7", email: "sofia.a.martinez.27@dartmouth.edu", name: "Sofia Martinez", firstName: "Sofia", lastName: "Martinez" },
    }),
    prisma.user.upsert({
      where: { email: "f007no8@dartmouth.edu" },
      update: {},
      create: { netId: "f007no8", email: "noah.r.williams.28@dartmouth.edu", name: "Noah Williams", firstName: "Noah", lastName: "Williams" },
    }),
    prisma.user.upsert({
      where: { email: "f007ol9@dartmouth.edu" },
      update: {},
      create: { netId: "f007ol9", email: "olivia.k.brown.27@dartmouth.edu", name: "Olivia Brown", firstName: "Olivia", lastName: "Brown" },
    }),
    prisma.user.upsert({
      where: { email: "f007et0@dartmouth.edu" },
      update: {},
      create: { netId: "f007et0", email: "ethan.m.davis.28@dartmouth.edu", name: "Ethan Davis", firstName: "Ethan", lastName: "Davis" },
    }),
    prisma.user.upsert({
      where: { email: "f007av1@dartmouth.edu" },
      update: {},
      create: { netId: "f007av1", email: "ava.c.wilson.27@dartmouth.edu", name: "Ava Wilson", firstName: "Ava", lastName: "Wilson" },
    }),
    prisma.user.upsert({
      where: { email: "f007ma2@dartmouth.edu" },
      update: {},
      create: { netId: "f007ma2", email: "mason.h.taylor.28@dartmouth.edu", name: "Mason Taylor", firstName: "Mason", lastName: "Taylor" },
    }),
  ]);

  // Emma: submitted Engineering application
  await prisma.application.upsert({
    where: { id: "app-emma" },
    update: {},
    create: {
      id: "app-emma",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001": "I've been building side projects since freshman year and want to work on something with real users. DALI's shipping culture is exactly what I'm looking for.",
        "fq-00000000-0000-0000-0000-000000000002": "Sophomore, Computer Science and Math",
        "fq-00000000-0000-0000-0000-000000000003": "I run the Women in CS club and mentor underclassmen in intro CS.",
      },
      userId: emma.id,
      applicationCycleId: cycleWinter2027.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: emma.id, createdAt: ts(-3500) },
        { newStatus: "Submitted", userId: emma.id, createdAt: ts(-3000) },
      ] },
      domainApplications: { create: [{
        id: "da-emma-eng",
        challengeVersionId: engCv.id,
        answers: {
          "eq-00000000-0000-0000-0000-000000000001": "I built a peer-to-peer file sharing system for my networks class. The trickiest part was NAT traversal — I ended up implementing STUN/TURN relay as a fallback.",
          "eq-00000000-0000-0000-0000-000000000002": "github.com/emma/p2p-share — I'd add end-to-end encryption if I did it again.",
          "eq-00000000-0000-0000-0000-000000000003": "I've been learning about distributed consensus algorithms, especially Raft. The leader election protocol is elegant.",
        },
      }] },
    },
  });

  // Liam: submitted Engineering + Design application
  await prisma.application.upsert({
    where: { id: "app-liam" },
    update: {},
    create: {
      id: "app-liam",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001": "I'm a full-stack developer who also loves design. DALI is the only place on campus where I can do both.",
        "fq-00000000-0000-0000-0000-000000000002": "Junior, Computer Science modified with Digital Arts",
      },
      userId: liam.id,
      applicationCycleId: cycleWinter2027.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: liam.id, createdAt: ts(-3400) },
        { newStatus: "Submitted", userId: liam.id, createdAt: ts(-2800) },
      ] },
      domainApplications: { create: [
        {
          id: "da-liam-eng",
          challengeVersionId: engCv.id,
          answers: {
            "eq-00000000-0000-0000-0000-000000000001": "I refactored a legacy PHP monolith into a microservices architecture using Go. The challenge was maintaining backwards compatibility while migrating one service at a time.",
            "eq-00000000-0000-0000-0000-000000000002": "github.com/liam/go-migrate — I'd invest more in integration tests upfront.",
            "eq-00000000-0000-0000-0000-000000000003": "I'm exploring WebGL and Three.js to build interactive 3D data visualizations.",
          },
        },
        {
          id: "da-liam-design",
          challengeVersionId: designCv.id,
          answers: {
            "dq-00000000-0000-0000-0000-000000000001": "I start with competitive analysis, then create user personas and journey maps before wireframing in Figma. I always test with at least 5 users before moving to high-fidelity.",
            "dq-00000000-0000-0000-0000-000000000002": "dribbble.com/liam-designs",
            "dq-00000000-0000-0000-0000-000000000003": "Testing our campus dining app with international students revealed that our meal plan terminology was confusing. We added a glossary tooltip that reduced support tickets by 40%.",
          },
        },
      ] },
    },
  });

  // Sofia: submitted Design application
  await prisma.application.upsert({
    where: { id: "app-sofia" },
    update: {},
    create: {
      id: "app-sofia",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001": "I believe great products come from deep empathy for users. DALI's collaborative environment is where I want to sharpen my UX craft.",
        "fq-00000000-0000-0000-0000-000000000002": "Sophomore, Cognitive Science and Studio Art",
        "fq-00000000-0000-0000-0000-000000000003": "I volunteer at the Hood Museum designing accessible exhibit guides.",
      },
      userId: sofia.id,
      applicationCycleId: cycleWinter2027.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: sofia.id, createdAt: ts(-3300) },
        { newStatus: "Submitted", userId: sofia.id, createdAt: ts(-2700) },
      ] },
      domainApplications: { create: [{
        id: "da-sofia-design",
        challengeVersionId: designCv.id,
        answers: {
          "dq-00000000-0000-0000-0000-000000000001": "My process is research-first: contextual inquiry, affinity mapping, then rapid prototyping. I iterate based on usability testing, not stakeholder opinions.",
          "dq-00000000-0000-0000-0000-000000000002": "behance.net/sofia-martinez",
          "dq-00000000-0000-0000-0000-000000000003": "Accessibility testing with screen reader users completely changed how I think about information hierarchy. I now design content structure before visual layout.",
        },
      }] },
    },
  });

  // Noah: submitted Product application
  await prisma.application.upsert({
    where: { id: "app-noah" },
    update: {},
    create: {
      id: "app-noah",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001": "I've led two student org product launches and want to learn how a real product team operates. DALI's project structure mirrors industry workflows I want to master.",
        "fq-00000000-0000-0000-0000-000000000002": "Junior, Economics modified with Computer Science",
      },
      userId: noah.id,
      applicationCycleId: cycleWinter2027.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: noah.id, createdAt: ts(-3200) },
        { newStatus: "Submitted", userId: noah.id, createdAt: ts(-2600) },
      ] },
      domainApplications: { create: [{
        id: "da-noah-pm",
        challengeVersionId: pmCv.id,
        answers: {
          "pq-00000000-0000-0000-0000-000000000001": "Slack's notification system is overwhelming. I'd add an AI-powered digest that summarizes channels you haven't checked, prioritized by relevance. I'd validate with a 2-week diary study tracking notification fatigue.",
          "pq-00000000-0000-0000-0000-000000000002": "During a hackathon, we had to choose between building a native app or a PWA with 12 hours left. I ran a quick cost-benefit analysis, chose PWA for faster iteration, and we won Best Technical Implementation.",
        },
      }] },
    },
  });

  // Olivia: submitted Engineering application
  await prisma.application.upsert({
    where: { id: "app-olivia" },
    update: {},
    create: {
      id: "app-olivia",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001": "I want to bridge the gap between academic CS and real-world software engineering. DALI is the best place at Dartmouth to do that.",
        "fq-00000000-0000-0000-0000-000000000002": "Sophomore, Computer Science",
        "fq-00000000-0000-0000-0000-000000000003": "I'm on the club volleyball team and love the teamwork parallels between sports and software.",
      },
      userId: olivia.id,
      applicationCycleId: cycleWinter2027.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: olivia.id, createdAt: ts(-3100) },
        { newStatus: "Submitted", userId: olivia.id, createdAt: ts(-2500) },
      ] },
      domainApplications: { create: [{
        id: "da-olivia-eng",
        challengeVersionId: engCv.id,
        answers: {
          "eq-00000000-0000-0000-0000-000000000001": "I built a compiler for a subset of Python targeting LLVM IR. The hardest part was implementing closure capture correctly — I had to trace variable lifetimes across nested scopes.",
          "eq-00000000-0000-0000-0000-000000000002": "github.com/olivia/mini-python — I'd add proper error recovery in the parser instead of just panicking.",
          "eq-00000000-0000-0000-0000-000000000003": "I've been exploring formal verification with Lean 4. Proving properties about code is addictive once you get the hang of it.",
        },
      }] },
    },
  });

  // Ethan: submitted Product + Engineering application
  await prisma.application.upsert({
    where: { id: "app-ethan" },
    update: {},
    create: {
      id: "app-ethan",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001": "I'm a technical PM at heart — I love understanding systems deeply enough to make better product decisions. DALI lets me flex both muscles.",
        "fq-00000000-0000-0000-0000-000000000002": "Junior, Engineering Sciences",
      },
      userId: ethan.id,
      applicationCycleId: cycleWinter2027.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: ethan.id, createdAt: ts(-3000) },
        { newStatus: "Submitted", userId: ethan.id, createdAt: ts(-2400) },
      ] },
      domainApplications: { create: [
        {
          id: "da-ethan-pm",
          challengeVersionId: pmCv.id,
          answers: {
            "pq-00000000-0000-0000-0000-000000000001": "Google Maps' offline mode is clunky — you have to manually download areas. I'd auto-cache routes you frequently travel and validate by measuring data usage reduction in areas with spotty coverage.",
            "pq-00000000-0000-0000-0000-000000000002": "Leading a team of 6 to build a campus safety app with no budget. I talked to 50 students, identified the core need (walking alone at night), and scoped the MVP to just a buddy-matching feature.",
          },
        },
        {
          id: "da-ethan-eng",
          challengeVersionId: engCv.id,
          answers: {
            "eq-00000000-0000-0000-0000-000000000001": "I built a real-time collaborative whiteboard using WebSockets and operational transforms. The main challenge was conflict resolution when two users draw in the same area simultaneously.",
            "eq-00000000-0000-0000-0000-000000000002": "github.com/ethan/collab-board — I'd switch to CRDTs for better offline support.",
            "eq-00000000-0000-0000-0000-000000000003": "Kubernetes and container orchestration. I've been running a small homelab cluster to understand scheduling and resource limits.",
          },
        },
      ] },
    },
  });

  // Ava: submitted Design + Product application
  await prisma.application.upsert({
    where: { id: "app-ava" },
    update: {},
    create: {
      id: "app-ava",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001": "I'm passionate about the intersection of design and product strategy. DALI's project-based learning model is exactly how I learn best.",
        "fq-00000000-0000-0000-0000-000000000002": "Sophomore, Human-Centered Design and Engineering",
        "fq-00000000-0000-0000-0000-000000000003": "I spent last summer at a design consultancy in NYC working on healthcare UX.",
      },
      userId: ava.id,
      applicationCycleId: cycleWinter2027.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: ava.id, createdAt: ts(-2900) },
        { newStatus: "Submitted", userId: ava.id, createdAt: ts(-2300) },
      ] },
      domainApplications: { create: [
        {
          id: "da-ava-design",
          challengeVersionId: designCv.id,
          answers: {
            "dq-00000000-0000-0000-0000-000000000001": "I follow a double-diamond approach: diverge with research, converge on insights, diverge with ideation, converge on a tested solution. Every decision is backed by user evidence.",
            "dq-00000000-0000-0000-0000-000000000002": "figma.com/@ava-wilson-design",
            "dq-00000000-0000-0000-0000-000000000003": "We assumed patients wanted more data in our health dashboard. User testing showed they actually wanted less — just their top 3 actionable items. We cut 60% of the UI and satisfaction scores jumped.",
          },
        },
        {
          id: "da-ava-pm",
          challengeVersionId: pmCv.id,
          answers: {
            "pq-00000000-0000-0000-0000-000000000001": "Venmo's social feed is a privacy risk disguised as a feature. I'd make transactions private by default and add an opt-in 'share' button. Validation: track what percentage of users actively choose to share vs. the current passive exposure.",
            "pq-00000000-0000-0000-0000-000000000002": "Choosing between two competing research findings in a summer internship. One said users wanted simplicity, the other said they wanted power features. I segmented by user type and built progressive disclosure — simple by default, powerful on demand.",
          },
        },
      ] },
    },
  });

  // Mason: draft Engineering application (not yet submitted — edge case)
  await prisma.application.upsert({
    where: { id: "app-mason" },
    update: {},
    create: {
      id: "app-mason",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001": "I want to work on meaningful projects with a talented team.",
        "fq-00000000-0000-0000-0000-000000000002": "Junior, Computer Science",
      },
      userId: mason.id,
      applicationCycleId: cycleWinter2027.id,
      generalChallengeVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: mason.id, createdAt: ts(-2800) },
      ] },
      domainApplications: { create: [{
        id: "da-mason-eng",
        challengeVersionId: engCv.id,
        answers: {
          "eq-00000000-0000-0000-0000-000000000001": "Working on it...",
        },
      }] },
    },
  });

  // ── Domain lead user ──────────────────────────────────────────────────────
  const engLead = await prisma.user.upsert({
    where: { email: "eng.lead@dali.dartmouth.edu" },
    update: { firstName: "Mira", lastName: "Chen", name: "Mira Chen" },
    create: {
      email: "eng.lead@dali.dartmouth.edu",
      name: "Mira Chen",
      firstName: "Mira",
      lastName: "Chen",
      daliMember: { create: { daliEmail: "eng.lead@dali.dartmouth.edu", firstName: "Mira", lastName: "Chen" } },
    },
  });

  const engLeadMember = await prisma.dALIMember.update({
    where: { daliEmail: "eng.lead@dali.dartmouth.edu" },
    data: { firstName: "Mira", lastName: "Chen" },
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

  // ── Jordan Taylor (Hiring Lead + Engineering Domain Lead) ──────────────────
  const jordan = await prisma.user.upsert({
    where: { email: "jordan.taylor@dali.dartmouth.edu" },
    update: { firstName: "Jordan", lastName: "Taylor", name: "Jordan Taylor" },
    create: {
      email: "jordan.taylor@dali.dartmouth.edu",
      name: "Jordan Taylor",
      firstName: "Jordan",
      lastName: "Taylor",
      daliMember: {
        create: {
          daliEmail: "jordan.taylor@dali.dartmouth.edu",
          firstName: "Jordan",
          lastName: "Taylor",
          roles: ["HiringLead"],
        },
      },
    },
  });

  const jordanMember = await prisma.dALIMember.update({
    where: { daliEmail: "jordan.taylor@dali.dartmouth.edu" },
    data: { firstName: "Jordan", lastName: "Taylor" },
  });

  await prisma.domainLeadAssignment.upsert({
    where: { id: "dla-jordan-eng" },
    update: {},
    create: {
      id: "dla-jordan-eng",
      memberId: jordanMember.id,
      domainId: engDomain.id,
    },
  });

  // ── Interview config ──────────────────────────────────────────────────────
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

  // ── Reviewers + Interviewers ──────────────────────────────────────────────
  // Two reviewers+interviewers per domain so every domain app has enough
  // review coverage and invited applicants see real slot options.
  const reviewerData = [
    { email: "reviewer1@dali.dartmouth.edu", first: "Riley", last: "Okonkwo", domainId: engDomain.id },
    { email: "reviewer2@dali.dartmouth.edu", first: "Sam", last: "Alvarez", domainId: designDomain.id },
    { email: "reviewer3@dali.dartmouth.edu", first: "Pat", last: "Mikhailov", domainId: pmDomain.id },
    { email: "eng.lead@dali.dartmouth.edu", first: "Mira", last: "Chen", domainId: engDomain.id },
    { email: "design.lead@dali.dartmouth.edu", first: "Isabela", last: "Ferreira", domainId: designDomain.id },
    { email: "pm.lead@dali.dartmouth.edu", first: "Theo", last: "Abernathy", domainId: pmDomain.id },
  ];

  const reviewerMembers: Array<{ id: string; domainId: string }> = [];

  for (const r of reviewerData) {
    const user = await prisma.user.upsert({
      where: { email: r.email },
      update: { firstName: r.first, lastName: r.last, name: `${r.first} ${r.last}` },
      create: {
        email: r.email,
        name: `${r.first} ${r.last}`,
        firstName: r.first,
        lastName: r.last,
        daliMember: { create: { daliEmail: r.email, firstName: r.first, lastName: r.last } },
      },
    });

    const member = await prisma.dALIMember.findFirst({ where: { userId: user.id } });
    if (!member) continue;

    // Sync names onto the DALIMember row — the dashboard renders from there,
    // and older seeds created members without names.
    await prisma.dALIMember.update({
      where: { id: member.id },
      data: { firstName: r.first, lastName: r.last },
    });
    reviewerMembers.push({ id: member.id, domainId: r.domainId });

    // CycleReviewer (for written reviews)
    await prisma.cycleReviewer.upsert({
      where: {
        daliMemberId_applicationCycleId_domainId: {
          daliMemberId: member.id,
          applicationCycleId: cycle.id,
          domainId: r.domainId,
        },
      },
      update: {},
      create: {
        daliMemberId: member.id,
        applicationCycleId: cycle.id,
        domainId: r.domainId,
      },
    });

    // CycleInterviewer (for conducting interviews)
    await prisma.cycleInterviewer.upsert({
      where: {
        daliMemberId_applicationCycleId_domainId: {
          daliMemberId: member.id,
          applicationCycleId: cycle.id,
          domainId: r.domainId,
        },
      },
      update: {},
      create: {
        daliMemberId: member.id,
        applicationCycleId: cycle.id,
        domainId: r.domainId,
      },
    });
  }

  // ── Engineering reviewers for Winter 2027 ──────────────────────────────────
  for (const rm of reviewerMembers.filter(r => r.domainId === engDomain.id)) {
    await prisma.cycleReviewer.upsert({
      where: {
        daliMemberId_applicationCycleId_domainId: {
          daliMemberId: rm.id,
          applicationCycleId: cycleWinter2027.id,
          domainId: engDomain.id,
        },
      },
      update: {},
      create: {
        daliMemberId: rm.id,
        applicationCycleId: cycleWinter2027.id,
        domainId: engDomain.id,
      },
    });
  }

  // ── Winter 2027 terminal decisions ────────────────────────────────────────
  // Completed cycle: every submitted DomainApplication gets a single Released
  // Accept/Waitlist/Reject decision. We skip the Draft → Final audit chain
  // here (unlike Fall 2026) — Winter 2027 is a lightweight "past cycle"
  // backdrop and doesn't need full audit history. No reviewers/interviews are
  // seeded for its applicants.
  type TerminalSpec = { slug: string; domainAppId: string; type: "Accepted" | "Waitlisted" | "Rejected"; notes?: string };
  const winter2027Terminals: TerminalSpec[] = [
    { slug: "emma-eng", domainAppId: "da-emma-eng", type: "Accepted", notes: "Outstanding technical round." },
    { slug: "liam-eng", domainAppId: "da-liam-eng", type: "Accepted" },
    { slug: "liam-design", domainAppId: "da-liam-design", type: "Waitlisted" },
    { slug: "sofia-design", domainAppId: "da-sofia-design", type: "Accepted" },
    { slug: "noah-pm", domainAppId: "da-noah-pm", type: "Accepted" },
    { slug: "olivia-eng", domainAppId: "da-olivia-eng", type: "Rejected" },
    { slug: "ethan-pm", domainAppId: "da-ethan-pm", type: "Waitlisted" },
    { slug: "ethan-eng", domainAppId: "da-ethan-eng", type: "Rejected" },
    { slug: "ava-design", domainAppId: "da-ava-design", type: "Rejected" },
    { slug: "ava-pm", domainAppId: "da-ava-pm", type: "Rejected" },
  ];

  for (const [index, spec] of winter2027Terminals.entries()) {
    const id = `dec-w2027-${spec.slug}-released`;
    await prisma.decision.upsert({
      where: { id },
      update: {},
      create: {
        id,
        domainApplicationId: spec.domainAppId,
        type: spec.type,
        stage: "Released",
        madeById: jordanMember.id,
        // Waitlist rank is taken from the position inside the Waitlisted
        // subset (stable, deterministic).
        waitlistRank: spec.type === "Waitlisted"
          ? winter2027Terminals.filter(s => s.type === "Waitlisted").findIndex(s => s.slug === spec.slug) + 1
          : null,
        createdAt: ts(-2800 + index),
        notes: spec.notes ?? null,
      },
    });
  }

  // ── Interviewer availability ──────────────────────────────────────────────
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

  const allInterviewers = await prisma.cycleInterviewer.findMany({
    where: { applicationCycleId: cycle.id },
  });

  for (const interviewer of allInterviewers) {
    await prisma.interviewerAvailability.deleteMany({
      where: { cycleInterviewerId: interviewer.id },
    });
    for (const w of availabilityWindows) {
      await prisma.interviewerAvailability.create({
        data: { cycleInterviewerId: interviewer.id, startTime: w.startTime, endTime: w.endTime },
      });
    }
  }

  // ── Fall 2026 review + delibs + decision + interview seeding ─────────────
  // Look up every CycleReviewer by its member email so we can reference them
  // as either a reviewer or (later) as an interviewer.
  const designLeadMember = await prisma.dALIMember.findUniqueOrThrow({
    where: { daliEmail: "design.lead@dali.dartmouth.edu" },
  });
  const pmLeadMember = await prisma.dALIMember.findUniqueOrThrow({
    where: { daliEmail: "pm.lead@dali.dartmouth.edu" },
  });
  const rileyMember = await prisma.dALIMember.findUniqueOrThrow({
    where: { daliEmail: "reviewer1@dali.dartmouth.edu" },
  });
  const samMember = await prisma.dALIMember.findUniqueOrThrow({
    where: { daliEmail: "reviewer2@dali.dartmouth.edu" },
  });
  const patMember = await prisma.dALIMember.findUniqueOrThrow({
    where: { daliEmail: "reviewer3@dali.dartmouth.edu" },
  });

  async function getCycleReviewer(daliMemberId: string, domainId: string) {
    return prisma.cycleReviewer.findUniqueOrThrow({
      where: {
        daliMemberId_applicationCycleId_domainId: {
          daliMemberId,
          applicationCycleId: cycle.id,
          domainId,
        },
      },
    });
  }

  const rileyEngRv = await getCycleReviewer(rileyMember.id, engDomain.id);
  const engLeadRv = await getCycleReviewer(engLeadMember.id, engDomain.id);
  const samDesignRv = await getCycleReviewer(samMember.id, designDomain.id);
  const designLeadRv = await getCycleReviewer(designLeadMember.id, designDomain.id);
  const patPmRv = await getCycleReviewer(patMember.id, pmDomain.id);
  const pmLeadRv = await getCycleReviewer(pmLeadMember.id, pmDomain.id);

  // Strong/plausible scores — full 5s where it's a clear "Strong Hire", 3s
  // where it's borderline, 1–2s for the reject case. Keep the existing Alice
  // scores to preserve continuity with the prior seed.
  const engScoresStrong = { "rc-technical-depth": 5, "rc-problem-solving": 5, "rc-code-quality": 4, "rc-curiosity": 5 };
  const engScoresStrong2 = { "rc-technical-depth": 4, "rc-problem-solving": 5, "rc-code-quality": 4, "rc-curiosity": 5 };
  const engScoresMid = { "rc-technical-depth": 3, "rc-problem-solving": 4, "rc-code-quality": 3, "rc-curiosity": 4 };
  const engScoresLow = { "rc-technical-depth": 1, "rc-problem-solving": 2, "rc-code-quality": 1, "rc-curiosity": 2 };
  const designScoresStrong = { "rc-visual-craft": 5, "rc-design-process": 5, "rc-systems-thinking": 4, "rc-iteration": 5 };
  const designScoresMid = { "rc-visual-craft": 3, "rc-design-process": 4, "rc-systems-thinking": 3, "rc-iteration": 4 };
  const pmScoresStrong = { "rc-product-thinking": 5, "rc-decision-making": 4, "rc-user-empathy": 5 };
  const pmScoresMid = { "rc-product-thinking": 4, "rc-decision-making": 3, "rc-user-empathy": 4 };

  type ReviewSpec = {
    domainAppId: string;
    cycleReviewerId: string;
    scores: Record<string, number>;
    feedback: string;
    rejectionRationale?: string;
    overallRecommendation: string;
    submitted: boolean;
  };

  const reviewSpecs: ReviewSpec[] = [
    // Alice — Engineering: two submitted reviews. (Previously one was left
    // in-progress, which is inconsistent with her Released decision downstream.)
    {
      domainAppId: "da-alice-eng",
      cycleReviewerId: rileyEngRv.id,
      scores: engScoresStrong2,
      feedback: "Excellent systems thinking. The rate-limiter example shows real depth.",
      overallRecommendation: "Strong Hire",
      submitted: true,
    },
    {
      domainAppId: "da-alice-eng",
      cycleReviewerId: engLeadRv.id,
      scores: engScoresMid,
      feedback: "Good fundamentals, could use more specifics on the implementation.",
      overallRecommendation: "Hire",
      submitted: true,
    },
    // Diego — Engineering: strong, will be invited + booked
    {
      domainAppId: "da-diego-eng",
      cycleReviewerId: rileyEngRv.id,
      scores: engScoresStrong,
      feedback: "HM type-checker is ambitious for an intro-level project. Answers are precise.",
      overallRecommendation: "Strong Hire",
      submitted: true,
    },
    {
      domainAppId: "da-diego-eng",
      cycleReviewerId: engLeadRv.id,
      scores: engScoresStrong2,
      feedback: "Curiosity about deterministic simulation testing is a great signal.",
      overallRecommendation: "Strong Hire",
      submitted: true,
    },
    // Bob — Design
    {
      domainAppId: "da-bob-design",
      cycleReviewerId: samDesignRv.id,
      scores: designScoresStrong,
      feedback: "Clear process with concrete examples. Portfolio is solid.",
      overallRecommendation: "Hire",
      submitted: true,
    },
    {
      domainAppId: "da-bob-design",
      cycleReviewerId: designLeadRv.id,
      scores: designScoresMid,
      feedback: "Strong process story, visual craft a bit uneven across pieces.",
      overallRecommendation: "Lean Hire",
      submitted: true,
    },
    // Bob — Product
    {
      domainAppId: "da-bob-pm",
      cycleReviewerId: patPmRv.id,
      scores: pmScoresStrong,
      feedback: "Focus-mode pitch is thoughtful and measurable.",
      overallRecommendation: "Hire",
      submitted: true,
    },
    {
      domainAppId: "da-bob-pm",
      cycleReviewerId: pmLeadRv.id,
      scores: pmScoresMid,
      feedback: "Decision-making example was decent but stakeholder-light.",
      overallRecommendation: "Hire",
      submitted: true,
    },
    // Eve — Design
    {
      domainAppId: "da-eve-design",
      cycleReviewerId: samDesignRv.id,
      scores: designScoresStrong,
      feedback: "Paper-first approach and the kiosk case study are both strong signals.",
      overallRecommendation: "Strong Hire",
      submitted: true,
    },
    {
      domainAppId: "da-eve-design",
      cycleReviewerId: designLeadRv.id,
      scores: designScoresStrong,
      feedback: "The iteration story (cutting the map view) is textbook user-centered design.",
      overallRecommendation: "Hire",
      submitted: true,
    },
    // Felix — Product
    {
      domainAppId: "da-felix-pm",
      cycleReviewerId: patPmRv.id,
      scores: pmScoresStrong,
      feedback: "Canvas redesign pitch is grounded in a real pain point.",
      overallRecommendation: "Hire",
      submitted: true,
    },
    {
      domainAppId: "da-felix-pm",
      cycleReviewerId: pmLeadRv.id,
      scores: pmScoresMid,
      feedback: "Budget example was good; would like more explicit tradeoff analysis.",
      overallRecommendation: "Lean Hire",
      submitted: true,
    },
    // Grace — Engineering: reject
    {
      domainAppId: "da-grace-eng",
      cycleReviewerId: rileyEngRv.id,
      scores: engScoresLow,
      feedback: "Answers are thin and don't demonstrate technical depth.",
      rejectionRationale: "Experience level below what this cycle can support — recommend reapplying after CS 10/11.",
      overallRecommendation: "No Hire",
      submitted: true,
    },
    {
      domainAppId: "da-grace-eng",
      cycleReviewerId: engLeadRv.id,
      scores: engScoresLow,
      feedback: "No code samples and motivation feels generic.",
      rejectionRationale: "Insufficient technical background and unclear motivation for DALI specifically.",
      overallRecommendation: "Lean No Hire",
      submitted: true,
    },
    // Harper — Design: mid-review, one in-progress review only (no submitted)
    {
      domainAppId: "da-harper-design",
      cycleReviewerId: samDesignRv.id,
      scores: { "rc-visual-craft": 4, "rc-design-process": 3 },
      feedback: "Strong sketch work, still drafting thoughts on the iteration story.",
      overallRecommendation: "",
      submitted: false,
    },
  ];

  for (const spec of reviewSpecs) {
    const base = {
      scores: spec.scores,
      feedback: spec.feedback,
      rejectionRationale: spec.rejectionRationale ?? "",
      overallRecommendation: spec.overallRecommendation || null,
      annotations: [],
      submittedAt: spec.submitted ? ts(-500) : null,
      submittedById: spec.submitted ? engLeadMember.id : null,
    };
    await prisma.applicationReview.upsert({
      where: {
        cycleReviewerId_domainApplicationId: {
          cycleReviewerId: spec.cycleReviewerId,
          domainApplicationId: spec.domainAppId,
        },
      },
      update: base,
      create: {
        cycleReviewerId: spec.cycleReviewerId,
        domainApplicationId: spec.domainAppId,
        ...base,
      },
    });
  }

  // ── Initial DelibsSessions (Closed) ───────────────────────────────────────
  // Each domain's Initial delibs was run and closed: decided-interview cards
  // went to the Interview column, rejects to the Reject column. Harper is
  // deliberately absent from the Design session because her review isn't
  // all-submitted yet (delibs eligibility requires `every submittedAt != null`).
  await prisma.delibsSession.upsert({
    where: {
      domainId_applicationCycleId_type: {
        domainId: engDomain.id,
        applicationCycleId: cycle.id,
        type: "Initial",
      },
    },
    update: {
      status: "Closed",
      columnOrder: {
        "No Decision": [],
        "Interview": ["da-alice-eng", "da-diego-eng"],
        "Reject": ["da-grace-eng"],
      },
    },
    create: {
      domainId: engDomain.id,
      applicationCycleId: cycle.id,
      type: "Initial",
      status: "Closed",
      openedById: engLeadMember.id,
      columnOrder: {
        "No Decision": [],
        "Interview": ["da-alice-eng", "da-diego-eng"],
        "Reject": ["da-grace-eng"],
      },
    },
  });

  await prisma.delibsSession.upsert({
    where: {
      domainId_applicationCycleId_type: {
        domainId: designDomain.id,
        applicationCycleId: cycle.id,
        type: "Initial",
      },
    },
    update: {
      status: "Closed",
      columnOrder: {
        "No Decision": [],
        "Interview": ["da-bob-design", "da-eve-design"],
        "Reject": [],
      },
    },
    create: {
      domainId: designDomain.id,
      applicationCycleId: cycle.id,
      type: "Initial",
      status: "Closed",
      openedById: designLeadMember.id,
      columnOrder: {
        "No Decision": [],
        "Interview": ["da-bob-design", "da-eve-design"],
        "Reject": [],
      },
    },
  });

  await prisma.delibsSession.upsert({
    where: {
      domainId_applicationCycleId_type: {
        domainId: pmDomain.id,
        applicationCycleId: cycle.id,
        type: "Initial",
      },
    },
    update: {
      status: "Closed",
      columnOrder: {
        "No Decision": [],
        "Interview": ["da-bob-pm", "da-felix-pm"],
        "Reject": [],
      },
    },
    create: {
      domainId: pmDomain.id,
      applicationCycleId: cycle.id,
      type: "Initial",
      status: "Closed",
      openedById: pmLeadMember.id,
      columnOrder: {
        "No Decision": [],
        "Interview": ["da-bob-pm", "da-felix-pm"],
        "Reject": [],
      },
    },
  });

  // ── Decision audit chains ─────────────────────────────────────────────────
  // Each decision starts as Draft → Final. InvitedToInterview decisions also
  // get Released (required for interview booking). Rejected decisions stay at
  // Final so terminal-decision checks don't push the cycle into finalDelibs.
  type DecisionSpec = {
    slug: string;
    domainAppId: string;
    type: "InvitedToInterview" | "Rejected";
    madeBy: string;
    notes?: string;
  };
  const decisionSpecs: DecisionSpec[] = [
    { slug: "alice-eng", domainAppId: "da-alice-eng", type: "InvitedToInterview", madeBy: engLeadMember.id, notes: "Strong across both reviews." },
    { slug: "bob-design", domainAppId: "da-bob-design", type: "InvitedToInterview", madeBy: designLeadMember.id },
    { slug: "bob-pm", domainAppId: "da-bob-pm", type: "InvitedToInterview", madeBy: pmLeadMember.id },
    { slug: "diego-eng", domainAppId: "da-diego-eng", type: "InvitedToInterview", madeBy: engLeadMember.id, notes: "Top signal in the Engineering round." },
    { slug: "eve-design", domainAppId: "da-eve-design", type: "InvitedToInterview", madeBy: designLeadMember.id },
    { slug: "felix-pm", domainAppId: "da-felix-pm", type: "InvitedToInterview", madeBy: pmLeadMember.id },
    { slug: "grace-eng", domainAppId: "da-grace-eng", type: "Rejected", madeBy: engLeadMember.id, notes: "Both reviewers recommended no-hire." },
  ];

  for (const spec of decisionSpecs) {
    const baseId = `dec-${spec.slug}`;
    await prisma.decision.upsert({
      where: { id: `${baseId}-draft` },
      update: {},
      create: {
        id: `${baseId}-draft`,
        domainApplicationId: spec.domainAppId,
        type: spec.type,
        stage: "Draft",
        madeById: spec.madeBy,
        createdAt: ts(-450),
        notes: spec.notes ?? null,
      },
    });
    await prisma.decision.upsert({
      where: { id: `${baseId}-final` },
      update: {},
      create: {
        id: `${baseId}-final`,
        domainApplicationId: spec.domainAppId,
        type: spec.type,
        stage: "Final",
        madeById: spec.madeBy,
        createdAt: ts(-350),
        notes: spec.notes ?? null,
      },
    });
    // Release InvitedToInterview decisions (needed for interview booking).
    // Rejected decisions stay at Final to keep the cycle in readingApplications
    // stage for reviewers (Released Rejected would trigger finalDelibs).
    if (spec.type === "InvitedToInterview") {
      await prisma.decision.upsert({
        where: { id: `${baseId}-released` },
        update: {},
        create: {
          id: `${baseId}-released`,
          domainApplicationId: spec.domainAppId,
          type: spec.type,
          stage: "Released",
          madeById: jordanMember.id,
          createdAt: ts(-250),
          notes: spec.notes ?? null,
        },
      });
    }
  }

  // ── Booked interviews for Alice and Diego ─────────────────────────────────
  // Use the first two availabilityWindows entries (consecutive weekdays,
  // 14:00–16:00 UTC), pick the first 30-minute slot in each. Different days
  // guarantee Riley (shared InDomain interviewer) is never double-booked.
  async function getCycleInterviewer(daliMemberId: string, domainId: string) {
    return prisma.cycleInterviewer.findUniqueOrThrow({
      where: {
        daliMemberId_applicationCycleId_domainId: {
          daliMemberId,
          applicationCycleId: cycle.id,
          domainId,
        },
      },
    });
  }

  const rileyCI = await getCycleInterviewer(rileyMember.id, engDomain.id);
  const samCI = await getCycleInterviewer(samMember.id, designDomain.id);
  const patCI = await getCycleInterviewer(patMember.id, pmDomain.id);

  const interviewBookings: {
    id: string;
    domainAppId: string;
    window: { startTime: Date; endTime: Date };
    inDomainCI: { id: string };
    crossDomainCI: { id: string };
  }[] = [];

  if (availabilityWindows.length >= 2) {
    interviewBookings.push(
      {
        id: "interview-alice",
        domainAppId: "da-alice-eng",
        window: availabilityWindows[0],
        inDomainCI: rileyCI,
        crossDomainCI: samCI,
      },
      {
        id: "interview-diego",
        domainAppId: "da-diego-eng",
        window: availabilityWindows[1],
        inDomainCI: rileyCI,
        crossDomainCI: patCI,
      },
    );
  }

  const slotMs = 30 * 60 * 1000;
  for (const booking of interviewBookings) {
    const start = new Date(booking.window.startTime);
    const end = new Date(start.getTime() + slotMs);
    const interview = await prisma.interview.upsert({
      where: { id: booking.id },
      update: {
        startTime: start,
        endTime: end,
        status: "Scheduled",
      },
      create: {
        id: booking.id,
        domainApplicationId: booking.domainAppId,
        applicationCycleId: cycle.id,
        startTime: start,
        endTime: end,
        status: "Scheduled",
      },
    });

    await prisma.interviewAssignment.deleteMany({
      where: { interviewId: interview.id },
    });
    await prisma.interviewAssignment.createMany({
      data: [
        {
          interviewId: interview.id,
          cycleInterviewerId: booking.inDomainCI.id,
          role: "InDomain",
          status: "Active",
        },
        {
          interviewId: interview.id,
          cycleInterviewerId: booking.crossDomainCI.id,
          role: "CrossDomain",
          status: "Active",
        },
      ],
    });
  }

  console.log("Seed complete:");
  console.log(`  Admin: ${admin.firstName} ${admin.lastName}`);
  console.log(`  Domains: ${[designDomain, engDomain, pmDomain].map((d) => d.name).join(", ")}`);
  console.log(`  Rubrics: General, ${designRubric.name}, ${engRubric.name}, ${pmRubric.name}`);
  console.log(`  Cycle: ${cycle.name} (UnderReview) ← active`);
  console.log(`  Cycle: ${cycleWinter2027.name} (Completed) — 10 terminal decisions released`);
  console.log(`  Cycle: ${cycle2028.name} (Draft)`);
  console.log(`  Fall 2026 applicants:`);
  console.log(`    alice (eng) — booked interview`);
  console.log(`    bob (design+pm) — invited, not booked`);
  console.log(`    carol (eng) — draft`);
  console.log(`    diego (eng) — booked interview`);
  console.log(`    eve (design) — invited, not booked`);
  console.log(`    felix (pm) — invited, not booked`);
  console.log(`    grace (eng) — rejected`);
  console.log(`    harper (design) — pending review`);
  console.log(`    ivan (eng) — submitted, no reviewers assigned`);
  console.log(`    jade (design) — submitted, no reviewers assigned`);
  console.log(`    kenji (eng) — submitted, no reviewers assigned`);
  console.log(`    leo (eng) — submitted, no reviewers assigned`);
  console.log(`  Application: app-dana (submitted, Winter 2028)`);
  console.log(`  Winter 2027: emma(eng), liam(eng+design), sofia(design), noah(pm), olivia(eng), ethan(pm+eng), ava(design+pm), mason(eng/draft)`);
  console.log(`  Domain lead: ${engLead.firstName} ${engLead.lastName} → Engineering`);
  console.log(`  ${reviewerData.length} reviewers + ${reviewerData.length} interviewers seeded for Fall 2026`);
  console.log(`  ${allInterviewers.length} interviewers × ${availabilityWindows.length} availability blocks`);
  console.log(`  ${reviewSpecs.length} ApplicationReviews + ${decisionSpecs.length * 3} Decisions + ${interviewBookings.length} booked interviews for Fall 2026`);

  // ── Email templates ────────────────────────────────────────────────────────
  const defaultTemplates = [
    {
      templateKey: 'application_received',
      subject: 'We received your DALI application!',
      body: `Hi {{firstName}},\n\nThank you for applying to DALI! We've received your application and our team will be reviewing it over the coming weeks.\n\nWe'll reach out with updates as decisions are made. In the meantime, feel free to reach out to us at applications@dali.dartmouth.edu if you have any questions.\n\nBest,\nThe DALI Team`,
    },
    {
      templateKey: 'rejection',
      subject: 'Your DALI Application',
      body: `Hi {{firstName}},\n\nThank you so much for applying to DALI and for the time and effort you put into your application. After careful consideration, we regret to inform you that we will not be moving forward with your application for this cycle.\n\nThis was an incredibly competitive cycle, and this decision is not a reflection of your abilities or potential. We strongly encourage you to apply again in the future — many of our current members were not accepted on their first try.\n\nThank you again for your interest in DALI. We wish you all the best.\n\nWarm regards,\nThe DALI Team`,
    },
    {
      templateKey: 'interview_invite_applicant',
      subject: "You're invited to interview with DALI!",
      body: `Hi {{firstName}},\n\nCongratulations — we were impressed by your application and would love to invite you to interview with DALI!\n\nPlease log in to your application portal to view available interview slots and confirm your availability. Interviews are typically 20–30 minutes and held in person at the DALI Lab (Sudikoff 007).\n\nIf you have any scheduling conflicts or questions, please don't hesitate to reach out to us at applications@dali.dartmouth.edu.\n\nWe look forward to meeting you!\n\nBest,\nThe DALI Team`,
    },
    {
      templateKey: 'interview_invite_mentor',
      subject: 'DALI interview assigned to you',
      body: `Hi {{firstName}},\n\nYou've been assigned to conduct an interview for the current DALI hiring cycle. Please log in to the reviewer dashboard to view your assigned applicant(s) and interview details.\n\nIf you have any conflicts or questions, please reach out to the hiring lead as soon as possible.\n\nThanks for your help making DALI hiring happen!\n\n— The DALI Team`,
    },
    {
      templateKey: 'waitlist',
      subject: 'Update on your DALI application',
      body: `Hi {{firstName}},\n\nThank you for your patience as we reviewed applications for this cycle. We're excited to let you know that you've been placed on our waitlist!\n\nThis means we were very impressed by your application and interview, and if a spot opens up, we'd love to have you join the team. We'll be in touch with any updates.\n\nThank you again for your interest in DALI — we hope to work with you soon.\n\nBest,\nThe DALI Team`,
    },
    {
      templateKey: 'acceptance',
      subject: 'Welcome to DALI!',
      body: `Hi {{firstName}},\n\nWe are thrilled to offer you a spot in DALI!\n\nAfter a highly competitive review process, we believe you'll be a fantastic addition to our team. Please log in to your application portal to confirm your acceptance.\n\nOnboarding details and next steps will follow shortly. In the meantime, if you have any questions, feel free to reach out to us at applications@dali.dartmouth.edu.\n\nWelcome to the family — we can't wait to work with you!\n\nWarmly,\nThe DALI Team`,
    },
  ]
  for (const t of defaultTemplates) {
    await prisma.emailTemplate.upsert({
      where: { templateKey: t.templateKey },
      update: {},
      create: t,
    })
  }
  console.log(`  ${defaultTemplates.length} email templates seeded`)
  console.log(`  ${reviewSpecs.length} ApplicationReviews + ${decisionSpecs.filter(s => s.type === "InvitedToInterview").length * 3 + decisionSpecs.filter(s => s.type !== "InvitedToInterview").length * 2} Decisions + ${interviewBookings.length} booked interviews for Fall 2026`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
