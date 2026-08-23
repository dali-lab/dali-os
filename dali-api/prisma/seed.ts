import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { interpretBidForm } from "../app/projects/lib/bid-form-interpreter.js";
import {
  validateBids,
  replaceBidSet,
} from "../app/projects/lib/bid-validation.js";
import { interpretIntentForm } from "../app/projects/lib/intent-form-interpreter.js";
import { replaceIntentSet } from "../app/projects/lib/intent-validation.js";
import { syncDefaultGroups } from "../app/lib/groups.js";
import {
  ensureEducationTemplates,
  createOfferingApplicationForm,
} from "../app/education/lib/application-form.server.js";
import type { Question } from "../app/types.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // ── Admin user (creates forms, challenges, and cycle) ──────────────────────
  // Phase 2: DALIMember is a thin marker (no display fields). AdminMembership
  // confers the Admin role; CoreAssignment with leadTitle="Hiring Lead"
  // confers the legacy "HiringLead" semantic.
  const admin = await prisma.user.upsert({
    where: { daliEmail: "admin@dali.dartmouth.edu" },
    update: { firstName: "Admin", lastName: "User", handle: "adminuser" },
    create: {
      daliEmail: "admin@dali.dartmouth.edu",
      firstName: "Admin",
      lastName: "User",
      handle: "adminuser",
      daliMember: { create: {} },
    },
  });
  await prisma.adminMembership.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id },
  });

  // ── Term ───────────────────────────────────────────────────────────────────
  // Phase 2: CoreAssignment and DomainLeadAssignment require a termId. The
  // local seed below references this term for the test hiring lead +
  // domain leads. Prod seeds a full 12-term window via
  // prisma/seeds/v0-reference.ts; locally one term is enough.
  //
  // The window is anchored to "now" (start 30 days ago, end 60 days out) so the
  // seeded term is ALWAYS the active term — `currentTerm()` resolves by date, and
  // a fixed calendar window would expire and lock every Core member out of the
  // hiring/admin pages once the date passed (the e2e suite is date-independent
  // this way). Prod is unaffected: it seeds the full 12-term calendar, so
  // `currentTerm()` there falls back to the next upcoming term between terms.
  const now = new Date();
  const seedTermStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const seedTermEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  await prisma.term.upsert({
    where: { code: "26S" },
    // Update dates too, so an existing seed DB created before this fix (with the
    // old fixed 2026-03-28 → 2026-06-05 window) is corrected on re-seed.
    update: { startDate: seedTermStart, endDate: seedTermEnd },
    create: {
      code: "26S",
      year: 2026,
      season: "S",
      sortKey: 20262,
      startDate: seedTermStart,
      endDate: seedTermEnd,
    },
  });

  // ── Domains ────────────────────────────────────────────────────────────────
  // Phase 1 adds `code` + `displayName` to Domain. Local seeds populate them
  // so a fresh dev DB has consistent values; prod backfill is handled by the
  // v0 reference-data script (prisma/seeds/v0-reference.ts).
  // Local-seed displayName intentionally mirrors `name` so existing e2e tests
  // (which match on the legacy "Design"/"Engineering"/"Product" labels) keep
  // working. Prod uses the canonical catalog via prisma/seeds/v0-reference.ts
  // where displayName is the real catalog label (e.g. "UI/UX Design").
  const [designDomain, engDomain, pmDomain] = await Promise.all([
    prisma.domain.upsert({
      where: { id: "domain-design" },
      update: { code: "UIUX", displayName: "Design" },
      create: {
        id: "domain-design",
        name: "Design",
        code: "UIUX",
        displayName: "Design",
      },
    }),
    prisma.domain.upsert({
      where: { id: "domain-eng" },
      update: { code: "Fullstack", displayName: "Engineering" },
      create: {
        id: "domain-eng",
        name: "Engineering",
        code: "Fullstack",
        displayName: "Engineering",
      },
    }),
    prisma.domain.upsert({
      where: { id: "domain-pm" },
      update: { code: "PM", displayName: "Product" },
      create: {
        id: "domain-pm",
        name: "Product",
        code: "PM",
        displayName: "Product",
      },
    }),
  ]);

  // ── Domain challenge Forms (one Form per domain, immutable FormVersion snapshot) ─

  // ── Challenge versions (immutable snapshots) ───────────────────────────────
  const designQuestions = [
    {
      key: "dq-00000000-0000-0000-0000-000000000001",
      type: "figma_url",
      required: false,
      data: {
        label: "Submit your design challenge for UI/UX here!",
        description: "Enter your Figma link — make sure the permission settings are set to anyone with the link can view!",
      },
    },
    {
      key: "dq-00000000-0000-0000-0000-000000000002",
      type: "figma_url",
      required: false,
      data: {
        label: "Submit your design challenge for GRAPHICS here!",
        description: "Enter your Figma link — make sure the permission settings are set to anyone with the link can view!",
      },
    },
    {
      key: "dq-00000000-0000-0000-0000-000000000003",
      type: "figma_url",
      required: false,
      data: {
        label: "Submit your design challenge for ANIMATION here!",
        description: "Enter your Figma link — make sure the permission settings are set to anyone with the link can view!",
      },
    },
    {
      key: "dq-00000000-0000-0000-0000-000000000004",
      type: "figma_url",
      required: false,
      data: {
        label: "Submit your design challenge for 3D MODELING here!",
        description: "Enter your Figma link — make sure the permission settings are set to anyone with the link can view!",
      },
    },
    {
      key: "dq-00000000-0000-0000-0000-000000000005",
      type: "skills_rating",
      required: true,
      data: {
        label: "Designer Skills Rating",
        description: "Rate your experience with the following tools on a scale of 0-5. Respond with 0 if you've never used the application before and 5 if you have significant experience and skill.",
        options: ["Figma", "Sketch/Invision", "Adobe XD", "Adobe Photoshop", "Adobe Illustrator", "Adobe After Effects", "HTML/CSS"],
      },
    },
  ];

  const engQuestions = [
    {
      key: "eq-00000000-0000-0000-0000-000000000001",
      type: "github_url",
      required: false,
      data: {
        label: "Submit a Github link to your FULLSTACK Developer Challenge here!",
        description: "Please double check that the repository is publicly viewable and that you have an in-depth README that explains your code.",
      },
    },
    {
      key: "eq-00000000-0000-0000-0000-000000000002",
      type: "github_url",
      required: false,
      data: {
        label: "Submit a Github link to your DATA Developer Challenge here!",
        description: "Please double check that the repository is publicly viewable and that you have an in-depth README that explains your code.",
      },
    },
    {
      key: "eq-00000000-0000-0000-0000-000000000003",
      type: "github_url",
      required: false,
      data: {
        label: "Submit a Github link to your AR/VR Developer Challenge here!",
        description: "Please double check that the repository is publicly viewable and that you have an in-depth README that explains your code.",
      },
    },
    {
      key: "eq-00000000-0000-0000-0000-000000000004",
      type: "github_url",
      required: false,
      data: {
        label: "Submit a Github link to your outside code sample here!",
        description: "Please double check that the repository is publicly viewable and that you have an in-depth README that explains your code.",
      },
    },
    {
      key: "eq-00000000-0000-0000-0000-000000000005",
      type: "skills_rating",
      required: true,
      data: {
        label: "Developer Skills Rating",
        description: "Rate your experience with the following languages/frameworks on a scale of 0-5. Respond with 0 if you've never used the language/framework before and 5 if you have significant experience and skill to the point where you don't need to look at documentation.\n\nDon't be intimidated by the number of skills here — we definitely don't expect you to know all of them!",
        options: ["Bash/Terminal", "Git", "C", "C#", "Unity", "JavaScript", "TypeScript", "Python", "Ruby (on Rails)", "React.js", "React Native", "Swift", "Flutter", "iOS", "Android", "MongoDB", "Express", "Node.js", "SQL", "IoT", "R", "Tidy-Verse", "Pandas", "D3", "Figma", "SKlearn", "Deep/Machine Learning", "Cloud Data Storage"],
      },
    },
    {
      key: "eq-00000000-0000-0000-0000-000000000006",
      type: "textarea",
      required: false,
      data: {
        label: "Are there any other languages/frameworks/skills you'd like to highlight?",
        description: "List them and include a number to rate your confidence (e.g. C++ - 3, Unreal Engine - 5).",
      },
    },
  ];

  const pmQuestions = [
    {
      key: "pq-00000000-0000-0000-0000-000000000001",
      type: "file",
      required: true,
      data: {
        label: "Upload a PDF of your short answers and challenges here.",
        description: "Make sure to keep answers to 1-2 paragraphs (~200 words). The example agenda can be 1-2 pages with a 1-2 paragraph explanation afterward. Ensure that your file is in the correct format (PDF) and that all of your PM application materials are there!",
        accept: "application/pdf",
      },
    },
  ];

  const engQuestionsV2 = [
    {
      key: "eq2-00000000-0000-0000-0000-000000000001",
      type: "github_url",
      required: false,
      data: {
        label: "Submit a Github link to your FULLSTACK Developer Challenge here!",
        description: "Please double check that the repository is publicly viewable and that you have an in-depth README that explains your code.",
      },
    },
    {
      key: "eq2-00000000-0000-0000-0000-000000000002",
      type: "github_url",
      required: false,
      data: {
        label: "Submit a Github link to your DATA Developer Challenge here!",
        description: "Please double check that the repository is publicly viewable and that you have an in-depth README that explains your code.",
      },
    },
    {
      key: "eq2-00000000-0000-0000-0000-000000000003",
      type: "github_url",
      required: false,
      data: {
        label: "Submit a Github link to your outside code sample here!",
        description: "Please double check that the repository is publicly viewable and that you have an in-depth README that explains your code.",
      },
    },
    {
      key: "eq2-00000000-0000-0000-0000-000000000004",
      type: "skills_rating",
      required: true,
      data: {
        label: "Developer Skills Rating",
        description: "Rate your experience with the following languages/frameworks on a scale of 0-5.",
        options: ["Bash/Terminal", "Git", "JavaScript", "TypeScript", "Python", "React.js", "Node.js", "SQL"],
      },
    },
    {
      key: "eq2-00000000-0000-0000-0000-000000000005",
      type: "textarea",
      required: false,
      data: {
        label: "Are there any other languages/frameworks/skills you'd like to highlight?",
        description: "List them and include a number to rate your confidence (e.g. C++ - 3, Unreal Engine - 5).",
      },
    },
  ];

  // Each domain challenge is a Form with one FormVersion (immutable snapshot).
  // Using upsert-by-id so re-seeds are idempotent.
  const [designChallengeForm, engChallengeForm, engChallengeFormV2, pmChallengeForm] = await Promise.all([
    prisma.form.upsert({
      where: { id: "form-challenge-design" },
      update: {},
      create: {
        id: "form-challenge-design",
        name: "Design Challenge",
        createdById: admin.id,
        versions: {
          create: {
            id: "fv-design-v1",
            versionNumber: 1,
            questions: designQuestions,
            createdById: admin.id,
          },
        },
      },
      include: { versions: true },
    }),
    prisma.form.upsert({
      where: { id: "form-challenge-eng" },
      update: {},
      create: {
        id: "form-challenge-eng",
        name: "Engineering Challenge",
        createdById: admin.id,
        versions: {
          create: {
            id: "fv-eng-v1",
            versionNumber: 1,
            questions: engQuestions,
            createdById: admin.id,
          },
        },
      },
      include: { versions: true },
    }),
    prisma.form.upsert({
      where: { id: "form-challenge-eng-v2" },
      update: {},
      create: {
        id: "form-challenge-eng-v2",
        name: "Engineering Challenge v2",
        createdById: admin.id,
        versions: {
          create: {
            id: "fv-eng-v2",
            versionNumber: 1,
            questions: engQuestionsV2,
            createdById: admin.id,
          },
        },
      },
      include: { versions: true },
    }),
    prisma.form.upsert({
      where: { id: "form-challenge-pm" },
      update: {},
      create: {
        id: "form-challenge-pm",
        name: "Product Challenge",
        createdById: admin.id,
        versions: {
          create: {
            id: "fv-pm-v1",
            versionNumber: 1,
            questions: pmQuestions,
            createdById: admin.id,
          },
        },
      },
      include: { versions: true },
    }),
  ]);

  // Resolved FormVersion ids (first version of each form)
  const designCv = designChallengeForm.versions[0]!;
  const engCv = engChallengeForm.versions[0]!;
  const engCv2 = engChallengeFormV2.versions[0]!;
  const pmCv = pmChallengeForm.versions[0]!;

  // ── General application Form + FormVersion ────────────────────────────────

  const formQuestions = [
    {
      key: "fq-00000000-0000-0000-0000-000000000001",
      type: "text",
      required: true,
      data: { label: "First and Last Name" },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000002",
      type: "text",
      required: true,
      data: { label: "Dartmouth Net ID" },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000003",
      type: "select",
      required: true,
      data: {
        label: "Graduation Year",
        options: ["2026", "2027", "2028", "2029"],
      },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000004",
      type: "text",
      required: false,
      data: { label: "Pronouns" },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000005",
      type: "textarea",
      required: false,
      data: {
        label: "Have you applied to DALI in the past? If so, please update this application to reflect progress since your previous application!",
        description: "We are always excited to hear from repeat applicants!",
      },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000006",
      type: "text",
      required: true,
      data: { label: "Where did you hear about DALI Lab?" },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000007",
      type: "text",
      required: true,
      data: {
        label: "Intended Major(s) & Minor(s)",
        description: "If you're undecided, feel free to put that!",
      },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000008",
      type: "text",
      required: true,
      data: {
        label: "Terms you would intend to work for DALI in the next academic year",
        description: "These would be considered terms that you are on campus and willing to work if hired for. This could also line up with what your D-plan looks like!",
      },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000009",
      type: "select",
      required: true,
      data: {
        label: "Preferred/intended start term",
        description: "We expect accepted applicants to begin in either the Spring or following Fall term! We generally do not do deferrals, so if you are not available to begin in these upcoming terms please explain your circumstances above or reach out to applications@dali.dartmouth.edu.",
        options: ["Spring", "Fall"],
      },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000010",
      type: "textarea",
      required: true,
      data: {
        label: "How involved are you in your extracurricular activities?",
        description: "List each activity and its weekly time commitment (e.g. ENGS 12 TA: 4 hours)",
      },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000011",
      type: "textarea",
      required: true,
      data: {
        label: "How many hours would you be able to commit to DALI per week?",
        description: "We generally expect DALI members to commit 10-15 hours/week. DALI is also paid work, so feel free to elaborate upon whether DALI would replace the hours you might have spent on a different activity.",
      },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000012",
      type: "textarea",
      required: true,
      data: {
        label: "Please list any relevant experience to the work you would like to do at DALI.",
        description: "In particular, list any relevant courses that you've taken relating to your role (e.g. CS classes, art/design classes, etc.), as well as leadership roles.",
      },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000013",
      type: "text",
      required: true,
      data: {
        label: "Have you previously attended any DALI-sponsored workshops or mini-series?",
        description: "If yes, please list them here. If no, write \"None\".",
      },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000014",
      type: "textarea",
      required: true,
      data: { label: "Why do you want to work at DALI?" },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000015",
      type: "textarea",
      required: true,
      data: { label: "What is something that you've made and what did you love about it? Where did you stumble?" },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000016",
      type: "textarea",
      required: true,
      data: { label: "Describe a collaborative experience that you've had. What did you like about it and what could have been improved to make it more awesome?" },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000017",
      type: "textarea",
      required: false,
      data: { label: "Is there anything else you would like to highlight about yourself since you last applied?", afterDomains: true },
    },
    {
      key: "fq-00000000-0000-0000-0000-000000000018",
      type: "textarea",
      required: false,
      data: { label: "Is there anything else you'd like us to know that you haven't yet been able to touch on in this application?", afterDomains: true },
    },
  ];

  const generalApplicationForm = await prisma.form.upsert({
    where: { id: "form-general-application" },
    update: {},
    create: {
      id: "form-general-application",
      name: "General Application Form",
      createdById: admin.id,
      versions: {
        create: {
          id: "fv-general-application-v1",
          versionNumber: 1,
          questions: formQuestions,
          createdById: admin.id,
        },
      },
    },
    include: { versions: true },
  });
  const generalFormVersion = generalApplicationForm.versions[0]!;

  // ── Rubrics ────────────────────────────────────────────────────────────────

  // General rubric (attached to the main form version)
  const generalRubric = await prisma.rubric.upsert({
    where: { id: "rubric-general" },
    update: {},
    create: { id: "rubric-general", name: "General Application Rubric" },
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
    create: { id: "rubric-eng", name: "Engineering Rubric" },
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
    create: { id: "rubric-design", name: "Design Rubric" },
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
    create: { id: "rubric-pm", name: "Product Rubric" },
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
      applicationFormId: generalApplicationForm.id,
      domains: {
        create: [
          { domainId: designDomain.id, rubricVersionId: designRubricVersion.id },
          { domainId: engDomain.id, rubricVersionId: engRubricVersion.id },
          { domainId: pmDomain.id, rubricVersionId: pmRubricVersion.id },
        ],
      },
      domainChallengeForms: {
        create: [
          { domainId: designDomain.id, formId: designChallengeForm.id },
          { domainId: engDomain.id, formId: engChallengeForm.id },
          { domainId: pmDomain.id, formId: pmChallengeForm.id },
        ],
      },
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: admin.id, createdAt: ts(-3000) },
          { newStatus: "Open", userId: admin.id, createdAt: ts(-2000) },
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
        "fq-00000000-0000-0000-0000-000000000001": "Alice Johnson",
        "fq-00000000-0000-0000-0000-000000000002": "f007al1",
        "fq-00000000-0000-0000-0000-000000000003": "2028",
        "fq-00000000-0000-0000-0000-000000000004": "she/her",
        "fq-00000000-0000-0000-0000-000000000006": "Friend in DALI",
        "fq-00000000-0000-0000-0000-000000000007": "Computer Science",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter, Spring",
        "fq-00000000-0000-0000-0000-000000000009": "Fall",
        "fq-00000000-0000-0000-0000-000000000010": "CS 10 TA: 5 hours\nWomen in CS: 3 hours\nClub Tennis: 4 hours",
        "fq-00000000-0000-0000-0000-000000000011": "12-15 hours. DALI would replace my current grading shifts as a TA.",
        "fq-00000000-0000-0000-0000-000000000012": "CS 1, CS 10, CS 30 (current). TA for CS 10. Built several personal projects in React and Node.js.",
        "fq-00000000-0000-0000-0000-000000000013": "Intro to React Workshop (Fall 2025)",
        "fq-00000000-0000-0000-0000-000000000014": "DALI's focus on real-world impact and cross-functional teams is exactly the environment I want to grow in. I want to ship products that students actually use.",
        "fq-00000000-0000-0000-0000-000000000015": "I built a distributed rate-limiter for my systems class using a token-bucket algorithm. I loved seeing it handle real traffic patterns. I stumbled on handling clock skew across nodes — it took me a week to get right.",
        "fq-00000000-0000-0000-0000-000000000016": "In my systems class, our team of 4 built a mini MapReduce. I loved how we divided the work cleanly — I handled the shuffle phase while others did map and reduce. We could have improved our testing strategy; we only tested end-to-end and missed subtle edge cases.",
      },
      userId: alice.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001": "https://github.com/alice/fullstack-challenge",
              "eq-00000000-0000-0000-0000-000000000005": "Bash/Terminal: 4\nGit: 4\nC: 2\nC#: 0\nUnity: 0\nJavaScript: 4\nTypeScript: 3\nPython: 4\nRuby (on Rails): 0\nReact.js: 3\nReact Native: 1\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 2\nExpress: 3\nNode.js: 4\nSQL: 3\nIoT: 0\nR: 1\nTidy-Verse: 0\nPandas: 2\nD3: 1\nFigma: 1\nSKlearn: 1\nDeep/Machine Learning: 1\nCloud Data Storage: 1",
              "eq-00000000-0000-0000-0000-000000000006": "Rust - 2, Docker - 3",
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
        "fq-00000000-0000-0000-0000-000000000001": "Bob Chen",
        "fq-00000000-0000-0000-0000-000000000002": "f007bo2",
        "fq-00000000-0000-0000-0000-000000000003": "2027",
        "fq-00000000-0000-0000-0000-000000000004": "he/him",
        "fq-00000000-0000-0000-0000-000000000006": "DALI term showcase",
        "fq-00000000-0000-0000-0000-000000000007": "Studio Art, Government minor",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter",
        "fq-00000000-0000-0000-0000-000000000009": "Fall",
        "fq-00000000-0000-0000-0000-000000000010": "Dartmouth Journal of Art: 6 hours\nStudent Assembly: 3 hours\nIntramural basketball: 2 hours",
        "fq-00000000-0000-0000-0000-000000000011": "10-12 hours. I would step back from my Student Assembly role to make room.",
        "fq-00000000-0000-0000-0000-000000000012": "ARTS 17, ARTS 25 (graphic design), GOV 6. Art Director for Dartmouth Journal of Art. Led a UX redesign for a student org's website.",
        "fq-00000000-0000-0000-0000-000000000013": "Figma for Beginners Workshop (Winter 2025)",
        "fq-00000000-0000-0000-0000-000000000014": "I've admired DALI projects on campus for two years and want to contribute to products that reach real users. The mix of design and product work is a perfect fit for my skills.",
        "fq-00000000-0000-0000-0000-000000000015": "I redesigned the Dartmouth Journal of Art's print layout from scratch. I loved the challenge of balancing readability with visual impact. I stumbled on typography hierarchy — my first drafts were too busy and I had to simplify.",
        "fq-00000000-0000-0000-0000-000000000016": "Working on the Journal of Art editorial team, we had to coordinate between writers, photographers, and designers. I loved the creative energy, but we could have improved our feedback cadence — sometimes revisions came in too late.",
      },
      userId: bob.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: designCv.id,
            domainId: designDomain.id,
            answers: {
              "dq-00000000-0000-0000-0000-000000000001": "https://www.figma.com/file/abc123/bob-uiux-challenge",
              "dq-00000000-0000-0000-0000-000000000002": "https://www.figma.com/file/def456/bob-graphics-challenge",
              "dq-00000000-0000-0000-0000-000000000005": "Figma: 4\nSketch/Invision: 2\nAdobe XD: 1\nAdobe Photoshop: 4\nAdobe Illustrator: 4\nAdobe After Effects: 2\nHTML/CSS: 3",
            },
          },
          {
            id: "da-bob-pm",
            challengeFormVersionId: pmCv.id,
            domainId: pmDomain.id,
            answers: {
              "pq-00000000-0000-0000-0000-000000000001": "uploads/applications/app-bob/pq-00000000-0000-0000-0000-000000000001/pm-challenge.pdf",
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
        "fq-00000000-0000-0000-0000-000000000001": "Carol Patel",
        "fq-00000000-0000-0000-0000-000000000002": "f007ca3",
        "fq-00000000-0000-0000-0000-000000000003": "2026",
        "fq-00000000-0000-0000-0000-000000000007": "Computer Science",
      },
      userId: carol.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [{ newStatus: "Draft", userId: carol.id }],
      },
      domainApplications: {
        create: [
          {
            challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
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
      where: { netId: "f007di4" },
      update: {},
      create: {
        netId: "f007di4",
        dartmouthEmail: "diego.s.rivera.26@dartmouth.edu",
        firstName: "Diego",
        lastName: "Rivera",
      },
    }),
    prisma.user.upsert({
      where: { netId: "f007ev5" },
      update: {},
      create: {
        netId: "f007ev5",
        dartmouthEmail: "eve.m.park.27@dartmouth.edu",
        firstName: "Eve",
        lastName: "Park",
      },
    }),
    prisma.user.upsert({
      where: { netId: "f007fe6" },
      update: {},
      create: {
        netId: "f007fe6",
        dartmouthEmail: "felix.t.nguyen.26@dartmouth.edu",
        firstName: "Felix",
        lastName: "Nguyen",
      },
    }),
    prisma.user.upsert({
      where: { netId: "f007gr7" },
      update: {},
      create: {
        netId: "f007gr7",
        dartmouthEmail: "grace.l.okafor.28@dartmouth.edu",
        firstName: "Grace",
        lastName: "Okafor",
      },
    }),
    prisma.user.upsert({
      where: { netId: "f007ha8" },
      update: {},
      create: {
        netId: "f007ha8",
        dartmouthEmail: "harper.j.sato.27@dartmouth.edu",
        firstName: "Harper",
        lastName: "Sato",
      },
    }),
    prisma.user.upsert({
      where: { netId: "f007iv9" },
      update: {},
      create: {
        netId: "f007iv9",
        dartmouthEmail: "ivan.d.kozlov.28@dartmouth.edu",
        firstName: "Ivan",
        lastName: "Kozlov",
      },
    }),
    prisma.user.upsert({
      where: { netId: "f007ja0" },
      update: {},
      create: {
        netId: "f007ja0",
        dartmouthEmail: "jade.r.montgomery.27@dartmouth.edu",
        firstName: "Jade",
        lastName: "Montgomery",
      },
    }),
    prisma.user.upsert({
      where: { netId: "f007ke1" },
      update: {},
      create: {
        netId: "f007ke1",
        dartmouthEmail: "kenji.h.yamada.28@dartmouth.edu",
        firstName: "Kenji",
        lastName: "Yamada",
      },
    }),
    prisma.user.upsert({
      where: { netId: "f007le2" },
      update: {},
      create: {
        netId: "f007le2",
        dartmouthEmail: "leo.p.brennan.26@dartmouth.edu",
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
        "fq-00000000-0000-0000-0000-000000000001": "Diego Rivera",
        "fq-00000000-0000-0000-0000-000000000002": "f007di4",
        "fq-00000000-0000-0000-0000-000000000003": "2027",
        "fq-00000000-0000-0000-0000-000000000004": "he/him",
        "fq-00000000-0000-0000-0000-000000000006": "CS department mailing list",
        "fq-00000000-0000-0000-0000-000000000007": "Computer Science, Mathematics minor",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter, Spring",
        "fq-00000000-0000-0000-0000-000000000009": "Fall",
        "fq-00000000-0000-0000-0000-000000000010": "CS Research Assistant (Prof. Li): 8 hours\nACM Programming Club: 3 hours",
        "fq-00000000-0000-0000-0000-000000000011": "12-15 hours. DALI would replace my research assistant position.",
        "fq-00000000-0000-0000-0000-000000000012": "CS 1, CS 10, CS 30, CS 31, CS 50 (current). Research assistant building compilers. Strong background in systems programming and functional languages.",
        "fq-00000000-0000-0000-0000-000000000013": "None",
        "fq-00000000-0000-0000-0000-000000000014": "DALI blends research-quality engineering with products students actually use — that's rare and what I want to be part of.",
        "fq-00000000-0000-0000-0000-000000000015": "I wrote a type-checker for a small functional language as a final project. I loved the elegance of Hindley-Milner unification. I stumbled on implementing let-polymorphism — the generalization step took two weeks of painful debugging.",
        "fq-00000000-0000-0000-0000-000000000016": "In our compilers class, our team of 3 built a small optimizing compiler. I loved the clear module boundaries — I owned the type checker, one person did parsing, another did codegen. We could have improved by writing integration tests earlier instead of only testing at the end.",
      },
      userId: diego.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001": "https://github.com/diego/fullstack-challenge",
              "eq-00000000-0000-0000-0000-000000000002": "https://github.com/diego/data-challenge",
              "eq-00000000-0000-0000-0000-000000000004": "https://github.com/diego/hm-checker",
              "eq-00000000-0000-0000-0000-000000000005": "Bash/Terminal: 5\nGit: 5\nC: 4\nC#: 1\nUnity: 0\nJavaScript: 4\nTypeScript: 4\nPython: 5\nRuby (on Rails): 0\nReact.js: 3\nReact Native: 0\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 2\nExpress: 3\nNode.js: 4\nSQL: 4\nIoT: 0\nR: 3\nTidy-Verse: 1\nPandas: 4\nD3: 2\nFigma: 1\nSKlearn: 3\nDeep/Machine Learning: 2\nCloud Data Storage: 2",
              "eq-00000000-0000-0000-0000-000000000006": "OCaml - 4, Haskell - 3, LLVM - 2",
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
        "fq-00000000-0000-0000-0000-000000000001": "Eve Park",
        "fq-00000000-0000-0000-0000-000000000002": "f007ev5",
        "fq-00000000-0000-0000-0000-000000000003": "2028",
        "fq-00000000-0000-0000-0000-000000000004": "she/they",
        "fq-00000000-0000-0000-0000-000000000006": "DALI showcase event",
        "fq-00000000-0000-0000-0000-000000000007": "Studio Art, Cognitive Science minor",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter, Spring",
        "fq-00000000-0000-0000-0000-000000000009": "Fall",
        "fq-00000000-0000-0000-0000-000000000010": "Design for Dartmouth (student org): 5 hours\nHood Museum Volunteer: 3 hours\nYoga Club: 2 hours",
        "fq-00000000-0000-0000-0000-000000000011": "12-14 hours. I would reduce my museum volunteer hours to accommodate DALI.",
        "fq-00000000-0000-0000-0000-000000000012": "ARTS 8, ARTS 17, COGS 1, COGS 11. Lead designer for Design for Dartmouth student org. Experience with user research methods and prototyping.",
        "fq-00000000-0000-0000-0000-000000000013": "Figma for Beginners Workshop (Fall 2025), Design Thinking Mini-Series (Winter 2026)",
        "fq-00000000-0000-0000-0000-000000000014": "I want to design for a team that ships to real users and iterates — DALI projects do both. The cognitive science side of my studies gives me a unique lens on usability.",
        "fq-00000000-0000-0000-0000-000000000015": "I designed a library book-return kiosk interface as part of a UX course. I loved the constraint of designing for hurried users. I stumbled on information architecture — my first version had too many steps in the flow.",
        "fq-00000000-0000-0000-0000-000000000016": "In Design for Dartmouth, our team of 5 redesigned a campus wayfinding app. I loved that everyone brought different perspectives — an engineer, a writer, and three designers. We could have improved by doing user testing earlier instead of polishing mockups first.",
      },
      userId: eve.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: designCv.id,
            domainId: designDomain.id,
            answers: {
              "dq-00000000-0000-0000-0000-000000000001": "https://www.figma.com/file/eve123/eve-uiux-challenge",
              "dq-00000000-0000-0000-0000-000000000002": "https://www.figma.com/file/eve456/eve-graphics-challenge",
              "dq-00000000-0000-0000-0000-000000000005": "Figma: 5\nSketch/Invision: 2\nAdobe XD: 1\nAdobe Photoshop: 3\nAdobe Illustrator: 4\nAdobe After Effects: 1\nHTML/CSS: 2",
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
        "fq-00000000-0000-0000-0000-000000000001": "Felix Nguyen",
        "fq-00000000-0000-0000-0000-000000000002": "f007fe6",
        "fq-00000000-0000-0000-0000-000000000003": "2027",
        "fq-00000000-0000-0000-0000-000000000004": "he/him",
        "fq-00000000-0000-0000-0000-000000000006": "DALI website",
        "fq-00000000-0000-0000-0000-000000000007": "Economics, Government minor",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter",
        "fq-00000000-0000-0000-0000-000000000009": "Fall",
        "fq-00000000-0000-0000-0000-000000000010": "Dartmouth Entrepreneurship Club (President): 6 hours\nCS TA: 4 hours\nDartmouth Consulting Group: 3 hours",
        "fq-00000000-0000-0000-0000-000000000011": "10-12 hours. I would step down from the consulting group to prioritize DALI.",
        "fq-00000000-0000-0000-0000-000000000012": "ECON 1, ECON 22, GOV 3, CS 1. President of Entrepreneurship Club — ran two pitch competitions. Led product strategy for a student org's app launch.",
        "fq-00000000-0000-0000-0000-000000000013": "PM Workshop Series (Winter 2026)",
        "fq-00000000-0000-0000-0000-000000000014": "I'm drawn to DALI's combination of real stakeholders and short feedback loops. I want to learn how to run a product team in a setting where decisions actually ship.",
        "fq-00000000-0000-0000-0000-000000000015": "I led the launch of a campus event discovery app for the Entrepreneurship Club. I loved running user interviews and watching the product evolve. I stumbled on scope creep — we tried to add a social feed and it delayed launch by two weeks.",
        "fq-00000000-0000-0000-0000-000000000016": "Running the Entrepreneurship Club's pitch competition required coordinating judges, mentors, and 20 teams. I loved the energy of the event. We could have improved by creating a shared timeline earlier — last-minute logistics caused some confusion.",
      },
      userId: felix.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: pmCv.id,
            domainId: pmDomain.id,
            answers: {
              "pq-00000000-0000-0000-0000-000000000001": "uploads/applications/app-felix/pq-00000000-0000-0000-0000-000000000001/pm-challenge.pdf",
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
        "fq-00000000-0000-0000-0000-000000000001": "Grace Okafor",
        "fq-00000000-0000-0000-0000-000000000002": "f007gr7",
        "fq-00000000-0000-0000-0000-000000000003": "2029",
        "fq-00000000-0000-0000-0000-000000000006": "Activities fair",
        "fq-00000000-0000-0000-0000-000000000007": "Undecided",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter",
        "fq-00000000-0000-0000-0000-000000000009": "Fall",
        "fq-00000000-0000-0000-0000-000000000010": "Intramural soccer: 3 hours\nDorm council: 1 hour",
        "fq-00000000-0000-0000-0000-000000000011": "10 hours. I don't have many commitments right now.",
        "fq-00000000-0000-0000-0000-000000000012": "CS 1 (current). No prior coding experience before college.",
        "fq-00000000-0000-0000-0000-000000000013": "None",
        "fq-00000000-0000-0000-0000-000000000014": "I want to join DALI because it would look great on my resume and I want to learn to code.",
        "fq-00000000-0000-0000-0000-000000000015": "I built a calculator in CS 1. It was cool to see it work. I didn't really stumble on anything specific.",
        "fq-00000000-0000-0000-0000-000000000016": "In high school I worked on a group project for history class. It was fine. We could have communicated better.",
      },
      userId: grace.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000005": "Bash/Terminal: 1\nGit: 0\nC: 0\nC#: 0\nUnity: 0\nJavaScript: 1\nTypeScript: 0\nPython: 1\nRuby (on Rails): 0\nReact.js: 0\nReact Native: 0\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 0\nExpress: 0\nNode.js: 0\nSQL: 0\nIoT: 0\nR: 0\nTidy-Verse: 0\nPandas: 0\nD3: 0\nFigma: 0\nSKlearn: 0\nDeep/Machine Learning: 0\nCloud Data Storage: 0",
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
        "fq-00000000-0000-0000-0000-000000000001": "Harper Sato",
        "fq-00000000-0000-0000-0000-000000000002": "f007ha8",
        "fq-00000000-0000-0000-0000-000000000003": "2028",
        "fq-00000000-0000-0000-0000-000000000004": "they/them",
        "fq-00000000-0000-0000-0000-000000000006": "DALI term showcase",
        "fq-00000000-0000-0000-0000-000000000007": "Film & Media Studies",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter, Spring",
        "fq-00000000-0000-0000-0000-000000000009": "Spring",
        "fq-00000000-0000-0000-0000-000000000010": "Film Club (VP): 5 hours\nFreelance video editing: 4 hours\nDartmouth Broadcasting: 3 hours",
        "fq-00000000-0000-0000-0000-000000000011": "10-12 hours. I would scale back freelance work.",
        "fq-00000000-0000-0000-0000-000000000012": "FILM 1, FILM 14, ARTS 17. VP of Film Club. Freelance motion graphics and video editing for student organizations.",
        "fq-00000000-0000-0000-0000-000000000013": "None",
        "fq-00000000-0000-0000-0000-000000000014": "I've followed DALI term showcases for a year and the breadth of projects drew me in. I want to bring motion design and animation skills to product teams.",
        "fq-00000000-0000-0000-0000-000000000015": "I created a short animated explainer video for a campus sustainability campaign. I loved the storytelling challenge of condensing complex data into 60 seconds. I stumbled on pacing — my first cut was too fast and testers couldn't absorb the info.",
        "fq-00000000-0000-0000-0000-000000000016": "On Film Club's annual short film, I directed a team of 8. I loved the creative problem-solving when we lost our location and had to pivot. We could have improved by storyboarding more thoroughly before shooting — we wasted time on scenes we cut.",
      },
      userId: harper.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: designCv.id,
            domainId: designDomain.id,
            answers: {
              "dq-00000000-0000-0000-0000-000000000001": "https://www.figma.com/file/harper123/harper-uiux-challenge",
              "dq-00000000-0000-0000-0000-000000000003": "https://www.figma.com/file/harper456/harper-animation-challenge",
              "dq-00000000-0000-0000-0000-000000000005": "Figma: 3\nSketch/Invision: 1\nAdobe XD: 1\nAdobe Photoshop: 3\nAdobe Illustrator: 2\nAdobe After Effects: 4\nHTML/CSS: 2",
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
        "fq-00000000-0000-0000-0000-000000000001": "Ivan Kozlov",
        "fq-00000000-0000-0000-0000-000000000002": "f007iv9",
        "fq-00000000-0000-0000-0000-000000000003": "2029",
        "fq-00000000-0000-0000-0000-000000000004": "he/him",
        "fq-00000000-0000-0000-0000-000000000006": "Professor recommendation",
        "fq-00000000-0000-0000-0000-000000000007": "Computer Science, Physics minor",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter, Spring",
        "fq-00000000-0000-0000-0000-000000000009": "Spring",
        "fq-00000000-0000-0000-0000-000000000010": "Physics Research Lab: 6 hours\nRobotics Club: 4 hours",
        "fq-00000000-0000-0000-0000-000000000011": "10-12 hours. I would reduce my robotics club hours.",
        "fq-00000000-0000-0000-0000-000000000012": "CS 1, CS 10 (current), PHYS 13, PHYS 14. Built a simulation toolkit for a physics research group. Self-taught in Python and C.",
        "fq-00000000-0000-0000-0000-000000000013": "None",
        "fq-00000000-0000-0000-0000-000000000014": "I want to work on things where the deployment matters as much as the code — DALI fits that better than any student org I've seen.",
        "fq-00000000-0000-0000-0000-000000000015": "I built a numerical simulation toolkit for a physics research group. I loved optimizing the performance to handle large datasets. I stumbled on ad-hoc logging — I should have used structured traces from the start.",
        "fq-00000000-0000-0000-0000-000000000016": "In the Robotics Club, our team of 6 built an autonomous line-following robot. I loved the hardware-software integration challenge. We could have improved by defining clearer interfaces between the sensor team and the control team earlier.",
      },
      userId: ivan.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001": "https://github.com/ivan-k/fullstack-challenge",
              "eq-00000000-0000-0000-0000-000000000004": "https://github.com/ivan-k/sim-toolkit",
              "eq-00000000-0000-0000-0000-000000000005": "Bash/Terminal: 3\nGit: 3\nC: 3\nC#: 0\nUnity: 0\nJavaScript: 2\nTypeScript: 1\nPython: 4\nRuby (on Rails): 0\nReact.js: 1\nReact Native: 0\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 0\nExpress: 1\nNode.js: 2\nSQL: 1\nIoT: 2\nR: 0\nTidy-Verse: 0\nPandas: 3\nD3: 0\nFigma: 0\nSKlearn: 1\nDeep/Machine Learning: 1\nCloud Data Storage: 0",
              "eq-00000000-0000-0000-0000-000000000006": "MATLAB - 3, NumPy - 4",
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
        "fq-00000000-0000-0000-0000-000000000001": "Jade Montgomery",
        "fq-00000000-0000-0000-0000-000000000002": "f007ja0",
        "fq-00000000-0000-0000-0000-000000000003": "2027",
        "fq-00000000-0000-0000-0000-000000000004": "she/her",
        "fq-00000000-0000-0000-0000-000000000005": "Yes, I applied in Fall 2025 and was waitlisted. Since then I've completed the HCD capstone and led a design project for the library.",
        "fq-00000000-0000-0000-0000-000000000006": "Applied previously",
        "fq-00000000-0000-0000-0000-000000000007": "Geography, Human-Centered Design minor",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter",
        "fq-00000000-0000-0000-0000-000000000009": "Fall",
        "fq-00000000-0000-0000-0000-000000000010": "HCD Lab Assistant: 5 hours\nOutdoor Club: 3 hours\nFreelance UX work: 4 hours",
        "fq-00000000-0000-0000-0000-000000000011": "12-14 hours. I would reduce my freelance work.",
        "fq-00000000-0000-0000-0000-000000000012": "GEOG 5, GEOG 30, HCD 1, HCD 50 (capstone). Lab assistant for HCD program. Led wayfinding redesign project for Baker-Berry Library.",
        "fq-00000000-0000-0000-0000-000000000013": "Design Thinking Mini-Series (Winter 2025)",
        "fq-00000000-0000-0000-0000-000000000014": "DALI is the rare place where design work actually ships to real users on campus. That's what I want to be part of.",
        "fq-00000000-0000-0000-0000-000000000015": "I redesigned the wayfinding system for Baker-Berry Library. I loved the research phase — five-minute intercept interviews with real library visitors. I stumbled on scope — I tried to cover all four floors and should have focused on the main entrance first.",
        "fq-00000000-0000-0000-0000-000000000016": "In my HCD capstone, our team of 4 designed a campus accessibility tool. I loved how our different majors brought different lenses — a CS student, an engineer, and two designers. We could have improved by establishing a shared design language earlier.",
        "fq-00000000-0000-0000-0000-000000000017": "Since my last application, I completed the HCD capstone project and received an A. I also took on freelance UX work for two local nonprofits.",
      },
      userId: jade.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: designCv.id,
            domainId: designDomain.id,
            answers: {
              "dq-00000000-0000-0000-0000-000000000001": "https://www.figma.com/file/jade123/jade-uiux-challenge",
              "dq-00000000-0000-0000-0000-000000000002": "https://www.figma.com/file/jade456/jade-graphics-challenge",
              "dq-00000000-0000-0000-0000-000000000005": "Figma: 5\nSketch/Invision: 3\nAdobe XD: 2\nAdobe Photoshop: 3\nAdobe Illustrator: 4\nAdobe After Effects: 1\nHTML/CSS: 3",
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
        "fq-00000000-0000-0000-0000-000000000001": "Kenji Yamada",
        "fq-00000000-0000-0000-0000-000000000002": "f007ke1",
        "fq-00000000-0000-0000-0000-000000000003": "2029",
        "fq-00000000-0000-0000-0000-000000000004": "he/him",
        "fq-00000000-0000-0000-0000-000000000006": "Open-source community",
        "fq-00000000-0000-0000-0000-000000000007": "Computer Science",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter, Spring",
        "fq-00000000-0000-0000-0000-000000000009": "Fall",
        "fq-00000000-0000-0000-0000-000000000010": "Open-source contributions: 5 hours\nCS study group leader: 2 hours",
        "fq-00000000-0000-0000-0000-000000000011": "12-15 hours. I would scale back open-source contributions to focus on DALI projects.",
        "fq-00000000-0000-0000-0000-000000000012": "CS 1, CS 10 (current). Contributed to several open-source React libraries before college. Self-taught in web development since age 14.",
        "fq-00000000-0000-0000-0000-000000000013": "Intro to React Workshop (Fall 2025)",
        "fq-00000000-0000-0000-0000-000000000014": "I've contributed to a few open-source React libraries and want to work somewhere the feedback loop from code to user is this tight.",
        "fq-00000000-0000-0000-0000-000000000015": "I wrote a virtual-list component for my personal blog because existing libraries didn't handle variable-height rows well. I loved the performance optimization challenge. I stumbled on the measurement cache — ResizeObserver edge cases took a while to iron out.",
        "fq-00000000-0000-0000-0000-000000000016": "Contributing to an open-source React component library, I collaborated asynchronously with developers across time zones. I loved the code review culture and learning from experienced devs. We could have improved our onboarding docs — new contributors often got stuck on the build setup.",
      },
      userId: kenji.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001": "https://github.com/kenjiy/fullstack-challenge",
              "eq-00000000-0000-0000-0000-000000000004": "https://github.com/kenjiy/virtual-list-lite",
              "eq-00000000-0000-0000-0000-000000000005": "Bash/Terminal: 3\nGit: 4\nC: 1\nC#: 0\nUnity: 0\nJavaScript: 5\nTypeScript: 4\nPython: 2\nRuby (on Rails): 0\nReact.js: 5\nReact Native: 2\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 1\nExpress: 3\nNode.js: 4\nSQL: 1\nIoT: 0\nR: 0\nTidy-Verse: 0\nPandas: 0\nD3: 1\nFigma: 1\nSKlearn: 0\nDeep/Machine Learning: 0\nCloud Data Storage: 1",
              "eq-00000000-0000-0000-0000-000000000006": "Next.js - 3, Tailwind CSS - 4, WebGL - 2",
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
        "fq-00000000-0000-0000-0000-000000000001": "Leo Brennan",
        "fq-00000000-0000-0000-0000-000000000002": "f007le2",
        "fq-00000000-0000-0000-0000-000000000003": "2026",
        "fq-00000000-0000-0000-0000-000000000004": "he/him",
        "fq-00000000-0000-0000-0000-000000000005": "Yes, I applied in Winter 2025 and was rejected. Since then I've completed CS 50, built several full-stack projects, and contributed to open-source infrastructure tools.",
        "fq-00000000-0000-0000-0000-000000000006": "Previous applicant",
        "fq-00000000-0000-0000-0000-000000000007": "Mathematics, Computer Science minor",
        "fq-00000000-0000-0000-0000-000000000008": "Fall, Winter",
        "fq-00000000-0000-0000-0000-000000000009": "Fall",
        "fq-00000000-0000-0000-0000-000000000010": "CS Research (distributed systems): 8 hours\nMath tutoring center: 3 hours",
        "fq-00000000-0000-0000-0000-000000000011": "10-12 hours. I would reduce my tutoring center hours.",
        "fq-00000000-0000-0000-0000-000000000012": "CS 1, CS 10, CS 30, CS 31, CS 50, MATH 22, MATH 71. Research assistant in distributed systems lab. Built CI/CD automation tools for research projects.",
        "fq-00000000-0000-0000-0000-000000000013": "None",
        "fq-00000000-0000-0000-0000-000000000014": "I came to Dartmouth planning to do pure math and ended up loving infrastructure work. DALI's mix of research and shipping is exactly what I'm looking for.",
        "fq-00000000-0000-0000-0000-000000000015": "I automated a flaky CI matrix for a research lab. I loved the detective work of figuring out which failures were environment-dependent vs. real regressions. I stumbled on the quarantine logic — deciding when a flaky test should be promoted back to blocking took several iterations.",
        "fq-00000000-0000-0000-0000-000000000016": "In the distributed systems lab, our team of 5 worked on a consensus protocol implementation. I loved the rigorous approach to correctness. We could have improved by writing a formal specification first — we found bugs late that a TLA+ model would have caught.",
        "fq-00000000-0000-0000-0000-000000000017": "Since my last application, I've completed CS 50 (operating systems), contributed to two open-source CI tools, and built a log triage system used by three research groups.",
      },
      userId: leo.id,
      applicationCycleId: cycle.id,
      applicationFormVersionId: generalFormVersion.id,
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
            challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
            answers: {
              "eq-00000000-0000-0000-0000-000000000001": "https://github.com/leo-b/fullstack-challenge",
              "eq-00000000-0000-0000-0000-000000000004": "https://github.com/leo-b/tidy-ci",
              "eq-00000000-0000-0000-0000-000000000005": "Bash/Terminal: 5\nGit: 5\nC: 4\nC#: 0\nUnity: 0\nJavaScript: 3\nTypeScript: 3\nPython: 5\nRuby (on Rails): 1\nReact.js: 2\nReact Native: 0\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 2\nExpress: 2\nNode.js: 3\nSQL: 4\nIoT: 0\nR: 2\nTidy-Verse: 1\nPandas: 3\nD3: 1\nFigma: 0\nSKlearn: 2\nDeep/Machine Learning: 1\nCloud Data Storage: 3",
              "eq-00000000-0000-0000-0000-000000000006": "Rust - 3, Go - 4, Docker - 4, Kubernetes - 2, TLA+ - 2",
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
      applicationFormId: generalApplicationForm.id,
      domains: {
        create: [
          { domainId: designDomain.id },
          { domainId: engDomain.id },
          { domainId: pmDomain.id },
        ],
      },
      domainChallengeForms: {
        create: [
          { domainId: designDomain.id, formId: designChallengeForm.id },
          { domainId: engDomain.id, formId: engChallengeFormV2.id },
          { domainId: pmDomain.id, formId: pmChallengeForm.id },
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
        "fq-00000000-0000-0000-0000-000000000001": "Dana Kim",
        "fq-00000000-0000-0000-0000-000000000002": "f007da4",
        "fq-00000000-0000-0000-0000-000000000003": "2029",
        "fq-00000000-0000-0000-0000-000000000004": "she/her",
        "fq-00000000-0000-0000-0000-000000000006": "CS department email",
        "fq-00000000-0000-0000-0000-000000000007": "Computer Science",
        "fq-00000000-0000-0000-0000-000000000008": "Winter, Spring, Fall",
        "fq-00000000-0000-0000-0000-000000000009": "Spring",
        "fq-00000000-0000-0000-0000-000000000010": "ICPC Training: 6 hours\nCS Study Group: 2 hours\nBadminton Club: 3 hours",
        "fq-00000000-0000-0000-0000-000000000011": "12-15 hours. I would reduce ICPC training since the season ends in winter.",
        "fq-00000000-0000-0000-0000-000000000012": "CS 1, CS 10 (current). Competed in ICPC regionals (top 10). Built a real-time collaborative code editor using CRDTs as a personal project.",
        "fq-00000000-0000-0000-0000-000000000013": "None",
        "fq-00000000-0000-0000-0000-000000000014": "I want to build things that matter. DALI's track record of shipping real products is why I'm applying.",
        "fq-00000000-0000-0000-0000-000000000015": "I built a real-time collaborative code editor using CRDTs. I loved the elegance of eventual consistency. I stumbled on the merge logic — raw CRDTs got gnarly with nested data structures.",
        "fq-00000000-0000-0000-0000-000000000016": "In ICPC training, my team of 3 practices solving problems under time pressure. I love how we divide problems by difficulty and play to each person's strengths. We could improve by doing more post-contest analysis together instead of individually.",
        "fq-00000000-0000-0000-0000-000000000018": "I competed in ICPC regionals this fall and placed in the top 10.",
      },
      userId: dana.id,
      applicationCycleId: cycle2028.id,
      applicationFormVersionId: generalFormVersion.id,
      statusUpdates: {
        create: [
          { newStatus: "Draft", userId: dana.id, createdAt: ts(-2000) },
          { newStatus: "Submitted", userId: dana.id, createdAt: ts(-1000) },
        ],
      },
      domainApplications: {
        create: [
          {
            challengeFormVersionId: engCv2.id,
            domainId: engDomain.id,
            answers: {
              "eq2-00000000-0000-0000-0000-000000000001": "https://github.com/dana/fullstack-challenge",
              "eq2-00000000-0000-0000-0000-000000000003": "https://github.com/dana/collab-editor",
              "eq2-00000000-0000-0000-0000-000000000004": "Bash/Terminal: 3\nGit: 3\nJavaScript: 4\nTypeScript: 3\nPython: 4\nReact.js: 2\nNode.js: 3\nSQL: 2",
              "eq2-00000000-0000-0000-0000-000000000005": "WebAssembly - 2, C++ - 3, WebSockets - 3",
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
      applicationFormId: generalApplicationForm.id,
      domains: {
        create: [
          { domainId: designDomain.id },
          { domainId: engDomain.id },
          { domainId: pmDomain.id },
        ],
      },
      domainChallengeForms: {
        create: [
          { domainId: designDomain.id, formId: designChallengeForm.id },
          { domainId: engDomain.id, formId: engChallengeForm.id },
          { domainId: pmDomain.id, formId: pmChallengeForm.id },
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
      where: { netId: "f007em5" },
      update: {},
      create: { netId: "f007em5", dartmouthEmail: "emma.j.torres.27@dartmouth.edu", firstName: "Emma", lastName: "Torres" },
    }),
    prisma.user.upsert({
      where: { netId: "f007li6" },
      update: {},
      create: { netId: "f007li6", dartmouthEmail: "liam.t.nguyen.28@dartmouth.edu", firstName: "Liam", lastName: "Nguyen" },
    }),
    prisma.user.upsert({
      where: { netId: "f007so7" },
      update: {},
      create: { netId: "f007so7", dartmouthEmail: "sofia.a.martinez.27@dartmouth.edu", firstName: "Sofia", lastName: "Martinez" },
    }),
    prisma.user.upsert({
      where: { netId: "f007no8" },
      update: {},
      create: { netId: "f007no8", dartmouthEmail: "noah.r.williams.28@dartmouth.edu", firstName: "Noah", lastName: "Williams" },
    }),
    prisma.user.upsert({
      where: { netId: "f007ol9" },
      update: {},
      create: { netId: "f007ol9", dartmouthEmail: "olivia.k.brown.27@dartmouth.edu", firstName: "Olivia", lastName: "Brown" },
    }),
    prisma.user.upsert({
      where: { netId: "f007et0" },
      update: {},
      create: { netId: "f007et0", dartmouthEmail: "ethan.m.davis.28@dartmouth.edu", firstName: "Ethan", lastName: "Davis" },
    }),
    prisma.user.upsert({
      where: { netId: "f007av1" },
      update: {},
      create: { netId: "f007av1", dartmouthEmail: "ava.c.wilson.27@dartmouth.edu", firstName: "Ava", lastName: "Wilson" },
    }),
    prisma.user.upsert({
      where: { netId: "f007ma2" },
      update: {},
      create: { netId: "f007ma2", dartmouthEmail: "mason.h.taylor.28@dartmouth.edu", firstName: "Mason", lastName: "Taylor" },
    }),
  ]);

  // Emma: submitted Engineering application
  await prisma.application.upsert({
    where: { id: "app-emma" },
    update: {},
    create: {
      id: "app-emma",
      answers: {
        "fq-00000000-0000-0000-0000-000000000001": "Emma Torres",
        "fq-00000000-0000-0000-0000-000000000002": "f007em5",
        "fq-00000000-0000-0000-0000-000000000003": "2028",
        "fq-00000000-0000-0000-0000-000000000004": "she/her",
        "fq-00000000-0000-0000-0000-000000000006": "Women in CS club",
        "fq-00000000-0000-0000-0000-000000000007": "Computer Science, Mathematics minor",
        "fq-00000000-0000-0000-0000-000000000008": "Winter, Spring, Fall",
        "fq-00000000-0000-0000-0000-000000000009": "Spring",
        "fq-00000000-0000-0000-0000-000000000010": "Women in CS (President): 5 hours\nCS 1 Mentor: 3 hours\nClub Soccer: 4 hours",
        "fq-00000000-0000-0000-0000-000000000011": "12-14 hours. DALI would replace my mentoring hours since the term schedule aligns well.",
        "fq-00000000-0000-0000-0000-000000000012": "CS 1, CS 10, CS 30, MATH 22. President of Women in CS. Mentor for intro CS students. Built side projects in React and Python.",
        "fq-00000000-0000-0000-0000-000000000013": "Intro to React Workshop (Fall 2025)",
        "fq-00000000-0000-0000-0000-000000000014": "I've been building side projects since freshman year and want to work on something with real users. DALI's shipping culture is exactly what I'm looking for.",
        "fq-00000000-0000-0000-0000-000000000015": "I built a peer-to-peer file sharing system for my networks class. I loved the challenge of NAT traversal. I stumbled on implementing STUN/TURN relay as a fallback — the RFC was dense and my first implementation had subtle bugs.",
        "fq-00000000-0000-0000-0000-000000000016": "Running the Women in CS club, I coordinate events with 8 board members. I love how we divide ownership of different event series. We could have improved our handoff process between outgoing and incoming board members — a lot of institutional knowledge was lost.",
        "fq-00000000-0000-0000-0000-000000000018": "I run the Women in CS club and mentor underclassmen in intro CS.",
      },
      userId: emma.id,
      applicationCycleId: cycleWinter2027.id,
      applicationFormVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: emma.id, createdAt: ts(-3500) },
        { newStatus: "Submitted", userId: emma.id, createdAt: ts(-3000) },
      ] },
      domainApplications: { create: [{
        id: "da-emma-eng",
        challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
        answers: {
          "eq-00000000-0000-0000-0000-000000000001": "https://github.com/emma/fullstack-challenge",
          "eq-00000000-0000-0000-0000-000000000004": "https://github.com/emma/p2p-share",
          "eq-00000000-0000-0000-0000-000000000005": "Bash/Terminal: 3\nGit: 4\nC: 2\nC#: 0\nUnity: 0\nJavaScript: 4\nTypeScript: 3\nPython: 4\nRuby (on Rails): 0\nReact.js: 3\nReact Native: 0\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 1\nExpress: 2\nNode.js: 3\nSQL: 2\nIoT: 0\nR: 1\nTidy-Verse: 0\nPandas: 2\nD3: 0\nFigma: 1\nSKlearn: 1\nDeep/Machine Learning: 0\nCloud Data Storage: 1",
          "eq-00000000-0000-0000-0000-000000000006": "Socket.io - 3, WebRTC - 2",
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
        "fq-00000000-0000-0000-0000-000000000001": "Liam Nguyen",
        "fq-00000000-0000-0000-0000-000000000002": "f007li6",
        "fq-00000000-0000-0000-0000-000000000003": "2027",
        "fq-00000000-0000-0000-0000-000000000004": "he/him",
        "fq-00000000-0000-0000-0000-000000000006": "Friend in DALI",
        "fq-00000000-0000-0000-0000-000000000007": "Computer Science modified with Digital Arts",
        "fq-00000000-0000-0000-0000-000000000008": "Winter, Spring",
        "fq-00000000-0000-0000-0000-000000000009": "Spring",
        "fq-00000000-0000-0000-0000-000000000010": "Digital Arts Studio: 4 hours\nWeb Dev freelance: 5 hours\nFilm Club: 2 hours",
        "fq-00000000-0000-0000-0000-000000000011": "12-15 hours. I would drop my freelance web dev work.",
        "fq-00000000-0000-0000-0000-000000000012": "CS 1, CS 10, CS 30, ARTS 17, ARTS 25. Freelance web developer with focus on interactive front-ends. Experience with Three.js and WebGL.",
        "fq-00000000-0000-0000-0000-000000000013": "None",
        "fq-00000000-0000-0000-0000-000000000014": "I'm a full-stack developer who also loves design. DALI is the only place on campus where I can do both.",
        "fq-00000000-0000-0000-0000-000000000015": "I built an interactive 3D data visualization using Three.js for a digital arts class. I loved blending aesthetics with data accuracy. I stumbled on performance — my first version tried to render too many particles and crashed on mobile.",
        "fq-00000000-0000-0000-0000-000000000016": "On a freelance project, I worked with a designer and a copywriter to rebuild a local nonprofit's website. I loved how each person's expertise elevated the final product. We could have improved by setting up a shared Figma workspace earlier instead of emailing screenshots back and forth.",
      },
      userId: liam.id,
      applicationCycleId: cycleWinter2027.id,
      applicationFormVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: liam.id, createdAt: ts(-3400) },
        { newStatus: "Submitted", userId: liam.id, createdAt: ts(-2800) },
      ] },
      domainApplications: { create: [
        {
          id: "da-liam-eng",
          challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
          answers: {
            "eq-00000000-0000-0000-0000-000000000001": "https://github.com/liam/fullstack-challenge",
            "eq-00000000-0000-0000-0000-000000000004": "https://github.com/liam/go-migrate",
            "eq-00000000-0000-0000-0000-000000000005": "Bash/Terminal: 4\nGit: 4\nC: 2\nC#: 0\nUnity: 0\nJavaScript: 5\nTypeScript: 4\nPython: 3\nRuby (on Rails): 0\nReact.js: 4\nReact Native: 1\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 2\nExpress: 3\nNode.js: 4\nSQL: 2\nIoT: 0\nR: 0\nTidy-Verse: 0\nPandas: 1\nD3: 2\nFigma: 3\nSKlearn: 0\nDeep/Machine Learning: 0\nCloud Data Storage: 1",
            "eq-00000000-0000-0000-0000-000000000006": "Three.js - 4, WebGL - 3, Go - 3",
          },
        },
        {
          id: "da-liam-design",
          challengeFormVersionId: designCv.id,
            domainId: designDomain.id,
          answers: {
            "dq-00000000-0000-0000-0000-000000000001": "https://www.figma.com/file/liam123/liam-uiux-challenge",
            "dq-00000000-0000-0000-0000-000000000005": "Figma: 3\nSketch/Invision: 1\nAdobe XD: 1\nAdobe Photoshop: 2\nAdobe Illustrator: 2\nAdobe After Effects: 2\nHTML/CSS: 4",
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
        "fq-00000000-0000-0000-0000-000000000001": "Sofia Martinez",
        "fq-00000000-0000-0000-0000-000000000002": "f007so7",
        "fq-00000000-0000-0000-0000-000000000003": "2028",
        "fq-00000000-0000-0000-0000-000000000004": "she/her",
        "fq-00000000-0000-0000-0000-000000000006": "Hood Museum volunteer network",
        "fq-00000000-0000-0000-0000-000000000007": "Cognitive Science, Studio Art minor",
        "fq-00000000-0000-0000-0000-000000000008": "Winter, Spring, Fall",
        "fq-00000000-0000-0000-0000-000000000009": "Spring",
        "fq-00000000-0000-0000-0000-000000000010": "Hood Museum Volunteer (Design): 4 hours\nCognitive Science Society: 2 hours\nDance Ensemble: 3 hours",
        "fq-00000000-0000-0000-0000-000000000011": "10-12 hours. I would reduce dance rehearsal commitments.",
        "fq-00000000-0000-0000-0000-000000000012": "COGS 1, COGS 11, ARTS 8, ARTS 17. Volunteer designer for Hood Museum creating accessible exhibit guides. Experience with user research and accessibility testing.",
        "fq-00000000-0000-0000-0000-000000000013": "Design Thinking Mini-Series (Fall 2025)",
        "fq-00000000-0000-0000-0000-000000000014": "I believe great products come from deep empathy for users. DALI's collaborative environment is where I want to sharpen my UX craft.",
        "fq-00000000-0000-0000-0000-000000000015": "I designed accessible exhibit guides for the Hood Museum. I loved the challenge of making complex art history approachable. I stumbled on text sizing — what worked on screen was too small in the physical gallery setting.",
        "fq-00000000-0000-0000-0000-000000000016": "At the Hood Museum, I worked with curators, educators, and other student designers. I loved learning about the art from curators while bringing a fresh design perspective. We could have improved by testing prototypes with actual visitors earlier in the process.",
        "fq-00000000-0000-0000-0000-000000000018": "I volunteer at the Hood Museum designing accessible exhibit guides.",
      },
      userId: sofia.id,
      applicationCycleId: cycleWinter2027.id,
      applicationFormVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: sofia.id, createdAt: ts(-3300) },
        { newStatus: "Submitted", userId: sofia.id, createdAt: ts(-2700) },
      ] },
      domainApplications: { create: [{
        id: "da-sofia-design",
        challengeFormVersionId: designCv.id,
            domainId: designDomain.id,
        answers: {
          "dq-00000000-0000-0000-0000-000000000001": "https://www.figma.com/file/sofia123/sofia-uiux-challenge",
          "dq-00000000-0000-0000-0000-000000000002": "https://www.figma.com/file/sofia456/sofia-graphics-challenge",
          "dq-00000000-0000-0000-0000-000000000005": "Figma: 4\nSketch/Invision: 1\nAdobe XD: 2\nAdobe Photoshop: 3\nAdobe Illustrator: 3\nAdobe After Effects: 1\nHTML/CSS: 2",
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
        "fq-00000000-0000-0000-0000-000000000001": "Noah Williams",
        "fq-00000000-0000-0000-0000-000000000002": "f007no8",
        "fq-00000000-0000-0000-0000-000000000003": "2027",
        "fq-00000000-0000-0000-0000-000000000004": "he/him",
        "fq-00000000-0000-0000-0000-000000000006": "DALI website",
        "fq-00000000-0000-0000-0000-000000000007": "Economics modified with Computer Science",
        "fq-00000000-0000-0000-0000-000000000008": "Winter, Spring",
        "fq-00000000-0000-0000-0000-000000000009": "Spring",
        "fq-00000000-0000-0000-0000-000000000010": "Student Government (VP): 6 hours\nStartup Incubator: 4 hours\nIntramural volleyball: 2 hours",
        "fq-00000000-0000-0000-0000-000000000011": "10-12 hours. I would step back from the startup incubator.",
        "fq-00000000-0000-0000-0000-000000000012": "ECON 1, ECON 22, ECON 26, CS 1, CS 10. VP of Student Government. Led two student org product launches including a campus events app.",
        "fq-00000000-0000-0000-0000-000000000013": "PM Workshop Series (Fall 2025)",
        "fq-00000000-0000-0000-0000-000000000014": "I've led two student org product launches and want to learn how a real product team operates. DALI's project structure mirrors industry workflows I want to master.",
        "fq-00000000-0000-0000-0000-000000000015": "I built a campus events discovery app with a team of 4. I loved running user interviews and watching the product evolve from idea to launch. I stumbled on prioritization — we tried to build everything at once instead of shipping a focused MVP.",
        "fq-00000000-0000-0000-0000-000000000016": "Leading Student Government's tech initiative, I worked with designers, developers, and administrators. I loved bridging the gap between what students wanted and what was technically feasible. We could have improved by doing more regular check-ins with the dev team instead of just milestone reviews.",
      },
      userId: noah.id,
      applicationCycleId: cycleWinter2027.id,
      applicationFormVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: noah.id, createdAt: ts(-3200) },
        { newStatus: "Submitted", userId: noah.id, createdAt: ts(-2600) },
      ] },
      domainApplications: { create: [{
        id: "da-noah-pm",
        challengeFormVersionId: pmCv.id,
            domainId: pmDomain.id,
        answers: {
          "pq-00000000-0000-0000-0000-000000000001": "uploads/applications/app-noah/pq-00000000-0000-0000-0000-000000000001/pm-challenge.pdf",
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
        "fq-00000000-0000-0000-0000-000000000001": "Olivia Brown",
        "fq-00000000-0000-0000-0000-000000000002": "f007ol9",
        "fq-00000000-0000-0000-0000-000000000003": "2028",
        "fq-00000000-0000-0000-0000-000000000004": "she/her",
        "fq-00000000-0000-0000-0000-000000000006": "CS class announcement",
        "fq-00000000-0000-0000-0000-000000000007": "Computer Science",
        "fq-00000000-0000-0000-0000-000000000008": "Winter, Spring, Fall",
        "fq-00000000-0000-0000-0000-000000000009": "Spring",
        "fq-00000000-0000-0000-0000-000000000010": "Club Volleyball: 6 hours\nCS 10 Grader: 3 hours\nOutdoor Club: 2 hours",
        "fq-00000000-0000-0000-0000-000000000011": "10-12 hours. I would drop my grading position.",
        "fq-00000000-0000-0000-0000-000000000012": "CS 1, CS 10, CS 30. Grader for CS 10. Built a mini Python compiler as a personal project.",
        "fq-00000000-0000-0000-0000-000000000013": "None",
        "fq-00000000-0000-0000-0000-000000000014": "I want to bridge the gap between academic CS and real-world software engineering. DALI is the best place at Dartmouth to do that.",
        "fq-00000000-0000-0000-0000-000000000015": "I built a compiler for a subset of Python targeting LLVM IR. I loved the satisfaction of seeing my compiled programs actually run. I stumbled on implementing closure capture — tracing variable lifetimes across nested scopes was much harder than I expected.",
        "fq-00000000-0000-0000-0000-000000000016": "On the club volleyball team, we work together under pressure during tournaments. I love the trust and communication required. We could have improved by doing more structured post-game analysis instead of just moving on to the next match.",
        "fq-00000000-0000-0000-0000-000000000018": "I'm on the club volleyball team and love the teamwork parallels between sports and software.",
      },
      userId: olivia.id,
      applicationCycleId: cycleWinter2027.id,
      applicationFormVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: olivia.id, createdAt: ts(-3100) },
        { newStatus: "Submitted", userId: olivia.id, createdAt: ts(-2500) },
      ] },
      domainApplications: { create: [{
        id: "da-olivia-eng",
        challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
        answers: {
          "eq-00000000-0000-0000-0000-000000000001": "https://github.com/olivia/fullstack-challenge",
          "eq-00000000-0000-0000-0000-000000000004": "https://github.com/olivia/mini-python",
          "eq-00000000-0000-0000-0000-000000000005": "Bash/Terminal: 3\nGit: 3\nC: 3\nC#: 0\nUnity: 0\nJavaScript: 3\nTypeScript: 2\nPython: 4\nRuby (on Rails): 0\nReact.js: 2\nReact Native: 0\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 1\nExpress: 1\nNode.js: 2\nSQL: 2\nIoT: 0\nR: 0\nTidy-Verse: 0\nPandas: 1\nD3: 0\nFigma: 0\nSKlearn: 0\nDeep/Machine Learning: 0\nCloud Data Storage: 0",
          "eq-00000000-0000-0000-0000-000000000006": "LLVM - 2, Lean 4 - 1",
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
        "fq-00000000-0000-0000-0000-000000000001": "Ethan Davis",
        "fq-00000000-0000-0000-0000-000000000002": "f007et0",
        "fq-00000000-0000-0000-0000-000000000003": "2027",
        "fq-00000000-0000-0000-0000-000000000004": "he/him",
        "fq-00000000-0000-0000-0000-000000000006": "Engineering department",
        "fq-00000000-0000-0000-0000-000000000007": "Engineering Sciences",
        "fq-00000000-0000-0000-0000-000000000008": "Winter, Spring",
        "fq-00000000-0000-0000-0000-000000000009": "Spring",
        "fq-00000000-0000-0000-0000-000000000010": "Engineering Design Lab: 5 hours\nCampus Safety App Team Lead: 4 hours\nHomelab/side projects: 3 hours",
        "fq-00000000-0000-0000-0000-000000000011": "12-15 hours. I would wind down my campus safety app role since it's near completion.",
        "fq-00000000-0000-0000-0000-000000000012": "ENGS 12, ENGS 21, ENGS 31, CS 1, CS 10. Led a team of 6 building a campus safety app. Experience with hardware-software integration and Kubernetes.",
        "fq-00000000-0000-0000-0000-000000000013": "None",
        "fq-00000000-0000-0000-0000-000000000014": "I'm a technical PM at heart — I love understanding systems deeply enough to make better product decisions. DALI lets me flex both muscles.",
        "fq-00000000-0000-0000-0000-000000000015": "I built a real-time collaborative whiteboard using WebSockets and operational transforms. I loved the challenge of making multi-user interactions feel seamless. I stumbled on conflict resolution when two users drew in the same area — the merge algorithm needed several iterations.",
        "fq-00000000-0000-0000-0000-000000000016": "Leading the campus safety app team, I coordinated 6 people across design and engineering. I loved translating user needs (feeling safe walking at night) into concrete features. We could have improved by doing more frequent user testing instead of building in isolation for two weeks.",
      },
      userId: ethan.id,
      applicationCycleId: cycleWinter2027.id,
      applicationFormVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: ethan.id, createdAt: ts(-3000) },
        { newStatus: "Submitted", userId: ethan.id, createdAt: ts(-2400) },
      ] },
      domainApplications: { create: [
        {
          id: "da-ethan-pm",
          challengeFormVersionId: pmCv.id,
            domainId: pmDomain.id,
          answers: {
            "pq-00000000-0000-0000-0000-000000000001": "uploads/applications/app-ethan/pq-00000000-0000-0000-0000-000000000001/pm-challenge.pdf",
          },
        },
        {
          id: "da-ethan-eng",
          challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
          answers: {
            "eq-00000000-0000-0000-0000-000000000001": "https://github.com/ethan/fullstack-challenge",
            "eq-00000000-0000-0000-0000-000000000004": "https://github.com/ethan/collab-board",
            "eq-00000000-0000-0000-0000-000000000005": "Bash/Terminal: 4\nGit: 3\nC: 3\nC#: 1\nUnity: 0\nJavaScript: 3\nTypeScript: 2\nPython: 3\nRuby (on Rails): 0\nReact.js: 2\nReact Native: 0\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 1\nExpress: 2\nNode.js: 3\nSQL: 2\nIoT: 2\nR: 0\nTidy-Verse: 0\nPandas: 1\nD3: 0\nFigma: 1\nSKlearn: 0\nDeep/Machine Learning: 0\nCloud Data Storage: 2",
            "eq-00000000-0000-0000-0000-000000000006": "Kubernetes - 3, Docker - 3, Arduino - 4",
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
        "fq-00000000-0000-0000-0000-000000000001": "Ava Wilson",
        "fq-00000000-0000-0000-0000-000000000002": "f007av1",
        "fq-00000000-0000-0000-0000-000000000003": "2028",
        "fq-00000000-0000-0000-0000-000000000004": "she/her",
        "fq-00000000-0000-0000-0000-000000000006": "Summer internship mentor",
        "fq-00000000-0000-0000-0000-000000000007": "Human-Centered Design, Engineering minor",
        "fq-00000000-0000-0000-0000-000000000008": "Winter, Spring, Fall",
        "fq-00000000-0000-0000-0000-000000000009": "Spring",
        "fq-00000000-0000-0000-0000-000000000010": "Design Consultancy Intern (summer): completed\nHCD Lab: 4 hours\nWomen in STEM: 2 hours",
        "fq-00000000-0000-0000-0000-000000000011": "12-14 hours. I have a manageable course load this term.",
        "fq-00000000-0000-0000-0000-000000000012": "HCD 1, HCD 40, ENGS 12, ENGS 21. Summer internship at a NYC design consultancy working on healthcare UX. Experience with user research, prototyping, and design systems.",
        "fq-00000000-0000-0000-0000-000000000013": "Design Thinking Mini-Series (Fall 2025)",
        "fq-00000000-0000-0000-0000-000000000014": "I'm passionate about the intersection of design and product strategy. DALI's project-based learning model is exactly how I learn best.",
        "fq-00000000-0000-0000-0000-000000000015": "I redesigned a patient intake form for a healthcare startup during my summer internship. I loved simplifying a complex process into clear steps. I stumbled on balancing regulatory requirements with good UX — some fields had to exist even though they confused users.",
        "fq-00000000-0000-0000-0000-000000000016": "At my internship, I worked with developers, a PM, and another designer on a health dashboard. I loved the double-diamond process we followed. We could have improved by including patients in our design reviews earlier — we relied too much on stakeholder proxies.",
        "fq-00000000-0000-0000-0000-000000000018": "I spent last summer at a design consultancy in NYC working on healthcare UX.",
      },
      userId: ava.id,
      applicationCycleId: cycleWinter2027.id,
      applicationFormVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: ava.id, createdAt: ts(-2900) },
        { newStatus: "Submitted", userId: ava.id, createdAt: ts(-2300) },
      ] },
      domainApplications: { create: [
        {
          id: "da-ava-design",
          challengeFormVersionId: designCv.id,
            domainId: designDomain.id,
          answers: {
            "dq-00000000-0000-0000-0000-000000000001": "I follow a double-diamond approach: diverge with research, converge on insights, diverge with ideation, converge on a tested solution. Every decision is backed by user evidence.",
            "dq-00000000-0000-0000-0000-000000000002": "figma.com/@ava-wilson-design",
            "dq-00000000-0000-0000-0000-000000000003": "We assumed patients wanted more data in our health dashboard. User testing showed they actually wanted less — just their top 3 actionable items. We cut 60% of the UI and satisfaction scores jumped.",
          },
        },
        {
          id: "da-ava-pm",
          challengeFormVersionId: pmCv.id,
            domainId: pmDomain.id,
          answers: {
            "pq-00000000-0000-0000-0000-000000000001": "uploads/applications/app-ava/pq-00000000-0000-0000-0000-000000000001/pm-challenge.pdf",
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
        "fq-00000000-0000-0000-0000-000000000001": "Mason Taylor",
        "fq-00000000-0000-0000-0000-000000000002": "f007ma2",
        "fq-00000000-0000-0000-0000-000000000003": "2028",
        "fq-00000000-0000-0000-0000-000000000007": "Computer Science",
      },
      userId: mason.id,
      applicationCycleId: cycleWinter2027.id,
      applicationFormVersionId: generalFormVersion.id,
      statusUpdates: { create: [
        { newStatus: "Draft", userId: mason.id, createdAt: ts(-2800) },
      ] },
      domainApplications: { create: [{
        id: "da-mason-eng",
        challengeFormVersionId: engCv.id,
            domainId: engDomain.id,
        answers: {},
      }] },
    },
  });

  // ── Domain lead user ──────────────────────────────────────────────────────
  const engLead = await prisma.user.upsert({
    where: { daliEmail: "eng.lead@dali.dartmouth.edu" },
    update: { firstName: "Mira", lastName: "Chen", handle: "mirachen" },
    create: {
      daliEmail: "eng.lead@dali.dartmouth.edu",
      firstName: "Mira",
      lastName: "Chen",
      handle: "mirachen",
      daliMember: { create: {} },
    },
  });

  await prisma.dALIMember.upsert({
    where: { userId: engLead.id },
    update: {},
    create: { userId: engLead.id },
  });

  const currentTermForSeed = await prisma.term.findFirst({
    orderBy: { sortKey: "desc" },
  });
  const termIdForSeed = currentTermForSeed?.id;

  await prisma.domainLeadAssignment.upsert({
    where: { id: "dla-eng-lead" },
    update: {},
    create: {
      id: "dla-eng-lead",
      userId: engLead.id,
      domainId: engDomain.id,
      termId: termIdForSeed!,
    },
  });

  // ── Jordan Taylor (Hiring Lead + Engineering Domain Lead) ──────────────────
  const jordan = await prisma.user.upsert({
    where: { daliEmail: "jordan.taylor@dali.dartmouth.edu" },
    update: { firstName: "Jordan", lastName: "Taylor", handle: "jordantaylor" },
    create: {
      daliEmail: "jordan.taylor@dali.dartmouth.edu",
      firstName: "Jordan",
      lastName: "Taylor",
      handle: "jordantaylor",
      daliMember: { create: {} },
    },
    include: { daliMember: true },
  });

  await prisma.dALIMember.upsert({
    where: { userId: jordan.id },
    update: {},
    create: { userId: jordan.id },
  });

  // HiringLead semantic via CoreAssignment.
  if (termIdForSeed) {
    const existingCore = await prisma.coreAssignment.findFirst({
      where: { userId: jordan.id, termId: termIdForSeed, leadTitle: "Hiring Lead" },
    });
    if (!existingCore) {
      await prisma.coreAssignment.create({
        data: { userId: jordan.id, termId: termIdForSeed, leadTitle: "Hiring Lead" },
      });
    }
  }

  await prisma.domainLeadAssignment.upsert({
    where: { id: "dla-jordan-eng" },
    update: {},
    create: {
      id: "dla-jordan-eng",
      userId: jordan.id,
      domainId: engDomain.id,
      termId: termIdForSeed!,
    },
  });

  // ── Confidentiality agreement (Fall 2026) ────────────────────────────────
  // Bind a signed agreement to the active cycle so domain leads and the hiring
  // lead can access confidentiality-gated pages in E2E tests. Confidentiality
  // is now a SigningDocument (gateScope HiringCycle) bound to the cycle via a
  // SigningBinding and signed as a SigningSignature (roleKey "member").
  await prisma.signingDocument.upsert({
    where: { id: "ca-fall-2026" },
    update: {},
    create: {
      id: "ca-fall-2026",
      name: "Fall 2026 Hiring Confidentiality Agreement",
      slug: "confidentiality-ca-fall-2026",
      gateScope: "HiringCycle",
      audience: "HiringParticipants",
    },
  });
  await prisma.signingDocumentVersion.upsert({
    where: { id: "cav-fall-2026-v1" },
    update: {},
    create: {
      id: "cav-fall-2026-v1",
      versionNumber: 1,
      body: { type: "doc", content: [] },
      roles: ["member"],
      publishedAt: new Date(),
      documentId: "ca-fall-2026",
      createdById: jordan.id,
    },
  });
  await prisma.signingBinding.upsert({
    where: { id: "sb-fall-2026" },
    update: {},
    create: {
      id: "sb-fall-2026",
      documentId: "ca-fall-2026",
      versionId: "cav-fall-2026-v1",
      scopeKey: `cycle:${cycle.id}`,
      cycleId: cycle.id,
    },
  });
  for (const [sigId, userId] of [
    ["cas-eng-lead", engLead.id],
    ["cas-jordan", jordan.id],
  ] as [string, string][]) {
    await prisma.signingSignature.upsert({
      where: {
        bindingId_signerUserId_roleKey: {
          bindingId: "sb-fall-2026",
          signerUserId: userId,
          roleKey: "member",
        },
      },
      update: {},
      create: {
        id: sigId,
        bindingId: "sb-fall-2026",
        versionId: "cav-fall-2026-v1",
        signerUserId: userId,
        roleKey: "member",
        typedName: "",
        fieldValues: {},
      },
    });
  }

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
  // reviewer3 and pm.lead intentionally left unsigned to seed the "pending"
  // state visible in the hiring-lead signatures list.
  const reviewerData = [
    { email: "reviewer1@dali.dartmouth.edu", first: "Riley", last: "Okonkwo", handle: "rileyokonkwo", domainId: engDomain.id, signed: true },
    { email: "reviewer2@dali.dartmouth.edu", first: "Sam", last: "Alvarez", handle: "samalvarez", domainId: designDomain.id, signed: true },
    { email: "reviewer3@dali.dartmouth.edu", first: "Pat", last: "Mikhailov", handle: "patmikhailov", domainId: pmDomain.id, signed: false },
    { email: "eng.lead@dali.dartmouth.edu", first: "Mira", last: "Chen", handle: "mirachen", domainId: engDomain.id, signed: true },
    { email: "design.lead@dali.dartmouth.edu", first: "Isabela", last: "Ferreira", handle: "isabelaferreira", domainId: designDomain.id, signed: true },
    { email: "pm.lead@dali.dartmouth.edu", first: "Theo", last: "Abernathy", handle: "theoabernathy", domainId: pmDomain.id, signed: false },
  ];

  const reviewerUsers: Array<{ id: string; domainId: string }> = [];

  for (const r of reviewerData) {
    const user = await prisma.user.upsert({
      where: { daliEmail: r.email },
      update: { firstName: r.first, lastName: r.last, handle: r.handle },
      create: {
        daliEmail: r.email,
        firstName: r.first,
        lastName: r.last,
        handle: r.handle,
        daliMember: { create: {} },
      },
    });

    // Ensure DALIMember marker exists (Phase 2).
    await prisma.dALIMember.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    reviewerUsers.push({ id: user.id, domainId: r.domainId });

    // CycleReviewer (for written reviews)
    await prisma.cycleReviewer.upsert({
      where: {
        userId_applicationCycleId_domainId: {
          userId: user.id,
          applicationCycleId: cycle.id,
          domainId: r.domainId,
        },
      },
      update: {},
      create: {
        userId: user.id,
        applicationCycleId: cycle.id,
        domainId: r.domainId,
      },
    });

    // CycleInterviewer (for conducting interviews)
    await prisma.cycleInterviewer.upsert({
      where: {
        userId_applicationCycleId_domainId: {
          userId: user.id,
          applicationCycleId: cycle.id,
          domainId: r.domainId,
        },
      },
      update: {},
      create: {
        userId: user.id,
        applicationCycleId: cycle.id,
        domainId: r.domainId,
      },
    });

    if (r.signed) {
      await prisma.signingSignature.upsert({
        where: {
          bindingId_signerUserId_roleKey: {
            bindingId: "sb-fall-2026",
            signerUserId: user.id,
            roleKey: "member",
          },
        },
        update: {},
        create: {
          bindingId: "sb-fall-2026",
          versionId: "cav-fall-2026-v1",
          signerUserId: user.id,
          roleKey: "member",
          typedName: "",
          fieldValues: {},
        },
      });
    }
  }

  // ── Engineering reviewers for Winter 2027 ──────────────────────────────────
  for (const ru of reviewerUsers.filter(r => r.domainId === engDomain.id)) {
    await prisma.cycleReviewer.upsert({
      where: {
        userId_applicationCycleId_domainId: {
          userId: ru.id,
          applicationCycleId: cycleWinter2027.id,
          domainId: engDomain.id,
        },
      },
      update: {},
      create: {
        userId: ru.id,
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
        madeById: jordan.id,
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
  // Look up every CycleReviewer by its user.id (Phase 2 — hiring FKs key on
  // userId, not DALIMember.id).
  const designLeadUser = await prisma.user.findUniqueOrThrow({
    where: { daliEmail: "design.lead@dali.dartmouth.edu" },
  });
  const pmLeadUser = await prisma.user.findUniqueOrThrow({
    where: { daliEmail: "pm.lead@dali.dartmouth.edu" },
  });
  const rileyUser = await prisma.user.findUniqueOrThrow({
    where: { daliEmail: "reviewer1@dali.dartmouth.edu" },
  });
  const samUser = await prisma.user.findUniqueOrThrow({
    where: { daliEmail: "reviewer2@dali.dartmouth.edu" },
  });
  const patUser = await prisma.user.findUniqueOrThrow({
    where: { daliEmail: "reviewer3@dali.dartmouth.edu" },
  });

  async function getCycleReviewer(userId: string, domainId: string) {
    return prisma.cycleReviewer.findUniqueOrThrow({
      where: {
        userId_applicationCycleId_domainId: {
          userId,
          applicationCycleId: cycle.id,
          domainId,
        },
      },
    });
  }

  const rileyEngRv = await getCycleReviewer(rileyUser.id, engDomain.id);
  const engLeadRv = await getCycleReviewer(engLead.id, engDomain.id);
  const samDesignRv = await getCycleReviewer(samUser.id, designDomain.id);
  const designLeadRv = await getCycleReviewer(designLeadUser.id, designDomain.id);
  const patPmRv = await getCycleReviewer(patUser.id, pmDomain.id);
  const pmLeadRv = await getCycleReviewer(pmLeadUser.id, pmDomain.id);

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
      submittedById: spec.submitted ? engLead.id : null,
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
      openedById: engLead.id,
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
      openedById: designLeadUser.id,
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
      openedById: pmLeadUser.id,
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
    { slug: "alice-eng", domainAppId: "da-alice-eng", type: "InvitedToInterview", madeBy: engLead.id, notes: "Strong across both reviews." },
    { slug: "bob-design", domainAppId: "da-bob-design", type: "InvitedToInterview", madeBy: designLeadUser.id },
    { slug: "bob-pm", domainAppId: "da-bob-pm", type: "InvitedToInterview", madeBy: pmLeadUser.id },
    { slug: "diego-eng", domainAppId: "da-diego-eng", type: "InvitedToInterview", madeBy: engLead.id, notes: "Top signal in the Engineering round." },
    { slug: "eve-design", domainAppId: "da-eve-design", type: "InvitedToInterview", madeBy: designLeadUser.id },
    { slug: "felix-pm", domainAppId: "da-felix-pm", type: "InvitedToInterview", madeBy: pmLeadUser.id },
    { slug: "grace-eng", domainAppId: "da-grace-eng", type: "Rejected", madeBy: engLead.id, notes: "Both reviewers recommended no-hire." },
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
          madeById: jordan.id,
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
  async function getCycleInterviewer(userId: string, domainId: string) {
    return prisma.cycleInterviewer.findUniqueOrThrow({
      where: {
        userId_applicationCycleId_domainId: {
          userId,
          applicationCycleId: cycle.id,
          domainId,
        },
      },
    });
  }

  const rileyCI = await getCycleInterviewer(rileyUser.id, engDomain.id);
  const samCI = await getCycleInterviewer(samUser.id, designDomain.id);
  const patCI = await getCycleInterviewer(patUser.id, pmDomain.id);

  const interviewBookings: {
    id: string;
    domainAppId: string;
    window: { startTime: Date; endTime: Date };
    inDomainCI: { id: string };
    crossDomainCI: { id: string };
    location: "PodAppa" | "PodMomo" | "Online";
  }[] = [];

  if (availabilityWindows.length >= 2) {
    interviewBookings.push(
      {
        id: "interview-alice",
        domainAppId: "da-alice-eng",
        window: availabilityWindows[0],
        inDomainCI: rileyCI,
        crossDomainCI: samCI,
        location: "PodAppa",
      },
      {
        id: "interview-diego",
        domainAppId: "da-diego-eng",
        window: availabilityWindows[1],
        inDomainCI: rileyCI,
        crossDomainCI: patCI,
        location: "PodMomo",
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
        location: booking.location,
      },
      create: {
        id: booking.id,
        domainApplicationId: booking.domainAppId,
        applicationCycleId: cycle.id,
        startTime: start,
        endTime: end,
        status: "Scheduled",
        location: booking.location,
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
  console.log(`  Cycle: ${cycle.name} (Open) ← active`);
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

  // ── Email templates (versioned, keyed by EmailTemplateType) ─────────────────
  const seedTemplates: { type: 'ApplicationReceived' | 'ApplicationExtensionNotice' | 'Rejected' | 'RejectedPostInterview' | 'InvitedToInterview' | 'InterviewInviteMentor' | 'InterviewConfirmedApplicant' | 'InterviewCancelledApplicant' | 'InterviewCancelledInterviewer' | 'InterviewLocationChanged' | 'Waitlisted' | 'Accepted'; subject: string; body: string }[] = [
    {
      type: 'ApplicationReceived',
      subject: 'We received your DALI application!',
      body: `Hi {{firstName}},\n\nThank you for applying to DALI! We've received your application and our team will be reviewing it over the coming weeks.\n\nWe'll reach out with updates as decisions are made. In the meantime, feel free to reach out to us at applications@dali.dartmouth.edu if you have any questions.\n\nBest,\nThe DALI Team`,
    },
    {
      type: 'ApplicationExtensionNotice',
      subject: 'DALI application deadline extended — finish your submission',
      body: `Hi {{firstName}},\n\nWe noticed you started a DALI application but haven't submitted yet. Good news — the application deadline has been extended.\n\nOriginal deadline: {{originalCloseDate}}\nNew deadline: {{newCloseDate}}\n\nLog back into the portal to finish and submit your application before the new deadline. If you have any questions, reach out to us at applications@dali.dartmouth.edu.\n\nBest,\nThe DALI Team`,
    },
    {
      type: 'Rejected',
      subject: 'Your DALI Application',
      body: `Hi {{firstName}},\n\nThank you so much for applying to DALI and for the time and effort you put into your application. After careful consideration, we regret to inform you that we will not be moving forward with your application for this cycle.\n\nThis was an incredibly competitive cycle, and this decision is not a reflection of your abilities or potential. We strongly encourage you to apply again in the future — many of our current members were not accepted on their first try.\n\nThank you again for your interest in DALI. We wish you all the best.\n\nWarm regards,\nThe DALI Team`,
    },
    {
      type: 'RejectedPostInterview',
      subject: 'Your DALI Application',
      body: `Hi {{firstName}},\n\nThank you for interviewing with DALI. We really enjoyed getting to know you, and we appreciate the time and effort you put into both your application and interview.\n\nAfter careful deliberation, we unfortunately will not be able to offer you a position for this cycle. This was an incredibly competitive cycle, and this decision does not reflect your abilities or potential.\n\nWe strongly encourage you to apply again in the future — many of our current members were not accepted on their first try.\n\nThank you again for your interest in DALI. We wish you all the best.\n\nWarm regards,\nThe DALI Team`,
    },
    {
      type: 'InvitedToInterview',
      subject: "You're invited to interview with DALI!",
      body: `Hi {{firstName}},\n\nCongratulations — we were impressed by your application and would love to invite you to interview with DALI!\n\nPlease log in to your application portal to view available interview slots and confirm your availability. Interviews are typically 20–30 minutes and held in person at the DALI Lab.\n\nIf you have any scheduling conflicts or questions, please don't hesitate to reach out to us at applications@dali.dartmouth.edu.\n\nWe look forward to meeting you!\n\nBest,\nThe DALI Team`,
    },
    {
      type: 'InterviewInviteMentor',
      subject: 'DALI interview assigned to you — {{domain}}',
      body: `Hi {{firstName}},\n\nYou've been assigned to conduct a {{domain}} interview.\n\nWhen: {{time}}\nWhere: {{location}}\n\nPlease log in to the reviewer dashboard to view your assigned applicant(s) and interview details. A calendar event is attached to this email.\n\nIf you have any conflicts or questions, please reach out to the hiring lead as soon as possible.\n\nThanks for your help making DALI hiring happen!\n\n— The DALI Team`,
    },
    {
      type: 'InterviewConfirmedApplicant',
      subject: 'Your {{domain}} interview is confirmed!',
      body: `Hi {{firstName}},\n\nYour interview for {{domain}} at DALI Lab is confirmed!\n\nWhen: {{time}}\nWhere: {{location}}\n\nA calendar event is attached to this email. If you need to reschedule, visit the applicant portal.\n\n— DALI Lab`,
    },
    {
      type: 'InterviewCancelledApplicant',
      subject: 'Your {{domain}} interview has been cancelled',
      body: `Hi {{firstName}},\n\nYour {{domain}} interview scheduled for {{time}} has been cancelled. The calendar event has been removed.\n\n— DALI Lab`,
    },
    {
      type: 'InterviewCancelledInterviewer',
      subject: '{{domain}} interview cancelled',
      body: `Hi {{firstName}},\n\nThe {{domain}} interview scheduled for {{time}} has been cancelled. The calendar event has been removed.\n\n— DALI Lab`,
    },
    {
      type: 'InterviewLocationChanged',
      subject: 'Interview location updated — {{domain}}',
      body: `Hi {{firstName}},\n\nThe location for your {{domain}} interview on {{time}} has been updated.\n\nNew location: {{location}}\n\nAn updated calendar event is attached.\n\n— DALI Lab`,
    },
    {
      type: 'Waitlisted',
      subject: 'Update on your DALI application',
      body: `Hi {{firstName}},\n\nThank you for your patience as we reviewed applications for this cycle. We're excited to let you know that you've been placed on our waitlist!\n\nThis means we were very impressed by your application and interview, and if a spot opens up, we'd love to have you join the team. We'll be in touch with any updates.\n\nThank you again for your interest in DALI — we hope to work with you soon.\n\nBest,\nThe DALI Team`,
    },
    {
      type: 'Accepted',
      subject: 'Welcome to DALI!',
      body: `Hi {{firstName}},\n\nWe are thrilled to offer you a spot in DALI!\n\nAfter a highly competitive review process, we believe you'll be a fantastic addition to our team. Please log in to your application portal to confirm your acceptance.\n\nOnboarding details and next steps will follow shortly. In the meantime, if you have any questions, feel free to reach out to us at applications@dali.dartmouth.edu.\n\nWelcome to the family — we can't wait to work with you!\n\nWarmly,\nThe DALI Team`,
    },
  ]
  // Every template lives as a named EmailTemplate parent + EmailTemplateVersion
  // (below); ApplicationReceived / InterviewInviteMentor bind to a cycle via
  // CycleNotificationEmail, the rest via CycleDecisionEmail. The old type-keyed
  // LegacyEmailTemplate table has been dropped.

  // New rubric-pattern templates: one named parent + one EmailTemplateVersion
  // per legacy type. Deterministic ids match the migration backfill so re-seeding
  // a freshly-migrated DB doesn't double-write.
  for (const t of seedTemplates) {
    const templateId = `tmpl_${t.type.toLowerCase()}`
    await prisma.emailTemplate.upsert({
      where: { id: templateId },
      update: {},
      create: { id: templateId, name: t.type },
    })
    const existingVersion = await prisma.emailTemplateVersion.findFirst({
      where: { templateId },
    })
    if (!existingVersion) {
      await prisma.emailTemplateVersion.create({
        data: {
          templateId,
          versionNumber: 1,
          subject: t.subject,
          body: t.body,
          createdById: engLead.id,
        },
      })
    }
  }

  // Bind Fall 2026 (the active seeded cycle) to the four DecisionType slots.
  for (const dt of ['Rejected', 'InvitedToInterview', 'Accepted', 'Waitlisted'] as const) {
    const version = await prisma.emailTemplateVersion.findFirst({
      where: { templateId: `tmpl_${dt.toLowerCase()}` },
      orderBy: { versionNumber: 'desc' },
    })
    if (version) {
      await prisma.cycleDecisionEmail.upsert({
        where: {
          applicationCycleId_decisionType: {
            applicationCycleId: cycle.id,
            decisionType: dt,
          },
        },
        update: { emailTemplateVersionId: version.id },
        create: {
          applicationCycleId: cycle.id,
          decisionType: dt,
          emailTemplateVersionId: version.id,
        },
      })
    }
  }

  // Bind Fall 2026 to all NotificationType slots.
  for (const nt of ['ApplicationReceived', 'ApplicationExtensionNotice', 'InterviewInviteMentor', 'InterviewConfirmedApplicant', 'InterviewCancelledApplicant', 'InterviewCancelledInterviewer', 'InterviewLocationChanged'] as const) {
    const version = await prisma.emailTemplateVersion.findFirst({
      where: { templateId: `tmpl_${nt.toLowerCase()}` },
      orderBy: { versionNumber: 'desc' },
    })
    if (version) {
      await prisma.cycleNotificationEmail.upsert({
        where: {
          applicationCycleId_notificationType: {
            applicationCycleId: cycle.id,
            notificationType: nt,
          },
        },
        update: { emailTemplateVersionId: version.id },
        create: {
          applicationCycleId: cycle.id,
          notificationType: nt,
          emailTemplateVersionId: version.id,
        },
      })
    }
  }
  console.log(`  ${seedTemplates.length} email templates seeded (2 legacy + 7 new + Fall 2026 decision + notification bindings)`)
  console.log(`  ${reviewSpecs.length} ApplicationReviews + ${decisionSpecs.filter(s => s.type === "InvitedToInterview").length * 3 + decisionSpecs.filter(s => s.type !== "InvitedToInterview").length * 2} Decisions + ${interviewBookings.length} booked interviews for Fall 2026`);

  // ── Partners + projects ────────────────────────────────────────────────────
  // Demo data for the /members and /projects/list views. Real ops data lives
  // behind the Admin Console UI (per v0-reference.ts) — this is just enough
  // to make the list pages non-empty in dev. Stable IDs keep re-runs idempotent.
  const partnerSeeds = [
    { id: "partner-tuck-school",  name: "Tuck School of Business", website: "https://www.tuck.dartmouth.edu", isIndividual: false },
    { id: "partner-hood-museum",  name: "Hood Museum of Art",      website: "https://hoodmuseum.dartmouth.edu", isIndividual: false },
    { id: "partner-thayer",       name: "Thayer School of Engineering", website: "https://engineering.dartmouth.edu", isIndividual: false },
    { id: "partner-prof-rocket",  name: "Prof. Devin Balkcom",     website: null, isIndividual: true },
    { id: "partner-dali-internal",name: "DALI Lab (Internal)",     website: "https://dali.dartmouth.edu", isIndividual: false },
  ];
  for (const p of partnerSeeds) {
    await prisma.partnerOrg.upsert({
      where: { id: p.id },
      update: { name: p.name, website: p.website, isIndividual: p.isIndividual },
      create: { id: p.id, name: p.name, website: p.website, isIndividual: p.isIndividual },
    });
  }

  const term26S = await prisma.term.findUnique({ where: { code: "26S" }, select: { id: true } });
  // Free hero images from Lorem Picsum (https://picsum.photos). Seeded URLs
  // are deterministic so the same project always gets the same image.
  const projectSeeds = [
    { id: "project-tuck-alumni",      name: "Tuck Alumni Connect",       status: "Active"   as const, termCount: 3, partnerIds: ["partner-tuck-school"],                  imageUrl: "https://picsum.photos/seed/project-tuck-alumni/1200/400" },
    { id: "project-hood-vr",          name: "Hood Museum AR Tour",       status: "Active"   as const, termCount: 2, partnerIds: ["partner-hood-museum"],                   imageUrl: "https://picsum.photos/seed/project-hood-vr/1200/400" },
    { id: "project-thayer-lab",       name: "Thayer Lab Booking",        status: "Active"   as const, termCount: 1, partnerIds: ["partner-thayer", "partner-dali-internal"], imageUrl: "https://picsum.photos/seed/project-thayer-lab/1200/400" },
    { id: "project-rocket-arm",       name: "Robotic Arm Telemetry",     status: "Paused"   as const, termCount: 4, partnerIds: ["partner-prof-rocket", "partner-thayer"],  imageUrl: "https://picsum.photos/seed/project-rocket-arm/1200/400" },
    { id: "project-dali-os",          name: "DALI OS",                   status: "Active"   as const, termCount: 6, partnerIds: ["partner-dali-internal"],                 imageUrl: "https://picsum.photos/seed/project-dali-os/1200/400" },
    { id: "project-archived-2023",    name: "Legacy Showcase Site",      status: "Archived" as const, termCount: 2, partnerIds: ["partner-dali-internal"],                 imageUrl: "https://picsum.photos/seed/project-archived-2023/1200/400" },
  ];
  for (const p of projectSeeds) {
    await prisma.project.upsert({
      where: { id: p.id },
      update: { name: p.name, status: p.status, termCount: p.termCount, imageUrl: p.imageUrl },
      create: { id: p.id, name: p.name, status: p.status, termCount: p.termCount, imageUrl: p.imageUrl },
    });
    // Seed the project's term set. Only 26S exists in the seed DB, so each
    // project gets that single term while termCount stays the (larger)
    // expected target — exercising the "actual < expected" display.
    if (term26S) {
      await prisma.projectTerm.upsert({
        where: { projectId_termId: { projectId: p.id, termId: term26S.id } },
        update: {},
        create: { projectId: p.id, termId: term26S.id },
      });
    }
    for (const partnerOrgId of p.partnerIds) {
      await prisma.projectPartner.upsert({
        where: { projectId_partnerOrgId: { projectId: p.id, partnerOrgId } },
        update: {},
        create: { projectId: p.id, partnerOrgId },
      });
    }
  }
  console.log(`  ${partnerSeeds.length} partner orgs, ${projectSeeds.length} projects, ${projectSeeds.reduce((n, p) => n + p.partnerIds.length, 0)} project-partner links`);

  // ── Partner applications ───────────────────────────────────────────────────
  // Demo data for /partners/applications: inbound pitches at different review
  // stages with per-domain expected scope so the term-projection chart is
  // non-empty in dev. Stable IDs keep re-runs idempotent. SOW collab docs are
  // created lazily when the editor first opens — not seeded here.
  // 26X exists in the v0-reference seed (26W..28F) but not the minimal local
  // seed (26S only). Fall back to 26S so the projection chart is still
  // populated locally; under v0-reference it spreads across two terms.
  const term26X =
    (await prisma.term.findUnique({ where: { code: "26X" }, select: { id: true } })) ??
    term26S;
  const partnerApplicationSeeds = [
    {
      id: "papp-hood-kiosk",
      title: "Interactive gallery kiosk",
      partnerOrgId: "partner-hood-museum",
      // Multi-term engagement: exercises the new multiple-target-terms UI.
      // 26X may not exist in the minimal local seed; filtered out below.
      targetTermIds: [term26S?.id, term26X?.id],
      status: "UnderReview" as const,
      summary: "Touchscreen kiosks that let visitors explore the permanent collection by theme.",
      domains: [
        { domainId: "domain-design", expectedMembers: 2, expectedChallenges: "Kiosk UX, wayfinding, and an accessible browsing flow for all ages." },
        { domainId: "domain-eng", expectedMembers: 3, expectedChallenges: "Offline-capable kiosk app + a CMS the curators can update." },
        { domainId: "domain-pm", expectedMembers: 1, expectedChallenges: "Scope with curatorial staff; coordinate the on-site install." },
      ],
    },
    {
      id: "papp-tuck-mentor",
      title: "Alumni mentorship matching",
      partnerOrgId: "partner-tuck-school",
      targetTermIds: [term26S?.id],
      status: "Accepted" as const,
      summary: "Match current students with alumni mentors by industry and interest.",
      domains: [
        { domainId: "domain-eng", expectedMembers: 2, expectedChallenges: "Matching algorithm + scheduling integration." },
        { domainId: "domain-pm", expectedMembers: 1, expectedChallenges: "Define the matching rubric with the alumni office." },
      ],
    },
    {
      id: "papp-thayer-sensors",
      title: "Lab sensor dashboard",
      partnerOrgId: "partner-thayer",
      targetTermIds: [term26X?.id],
      status: "ApplicationSubmitted" as const,
      summary: "Real-time dashboard for shared lab equipment sensor data.",
      domains: [
        { domainId: "domain-eng", expectedMembers: 3, expectedChallenges: "Time-series ingestion + live dashboard." },
      ],
    },
  ];
  for (const a of partnerApplicationSeeds) {
    // Account-first: every application is owned by a PartnerContact. Seed one
    // per application (deterministic email) so re-seeding stays idempotent.
    const applicant = await prisma.partnerContact.upsert({
      where: { email: `${a.partnerOrgId}@seed.dali` },
      update: {},
      create: { email: `${a.partnerOrgId}@seed.dali`, name: `${a.title} contact` },
      select: { id: true },
    });
    await prisma.partnerApplication.upsert({
      where: { id: a.id },
      update: { title: a.title, partnerOrgId: a.partnerOrgId, status: a.status, summary: a.summary },
      create: {
        id: a.id,
        title: a.title,
        partnerOrgId: a.partnerOrgId,
        applicantContactId: applicant.id,
        status: a.status,
        summary: a.summary,
      },
    });
    // Replace the target-term set each run so re-seeding stays idempotent.
    const termIds = [...new Set(a.targetTermIds.filter((t): t is string => Boolean(t)))];
    await prisma.partnerApplicationTargetTerm.deleteMany({ where: { applicationId: a.id } });
    if (termIds.length > 0) {
      await prisma.partnerApplicationTargetTerm.createMany({
        data: termIds.map((termId) => ({ applicationId: a.id, termId })),
      });
    }
    for (const d of a.domains) {
      await prisma.partnerApplicationDomain.upsert({
        where: { applicationId_domainId: { applicationId: a.id, domainId: d.domainId } },
        update: { expectedMembers: d.expectedMembers, expectedChallenges: d.expectedChallenges },
        create: { applicationId: a.id, domainId: d.domainId, expectedMembers: d.expectedMembers, expectedChallenges: d.expectedChallenges },
      });
    }
  }
  console.log(`  ${partnerApplicationSeeds.length} partner applications, ${partnerApplicationSeeds.reduce((n, a) => n + a.domains.length, 0)} domain-scope rows`);

  // The default lab-editable partner application form: /partner/apply appends
  // its questions to the structural pitch fields (title, terms, domain scope).
  // Core can retarget or edit it from /partners/applications — this just makes
  // the feature live out of the box.
  // Keep this question set in sync with the 20260730130000_partner_application_form_seed
  // migration, which creates the same form (same id) on environments the seed
  // never runs against.
  const partnerAppForm = await prisma.form.upsert({
    where: { id: "form-partner-application" },
    update: { published: true },
    create: {
      id: "form-partner-application",
      name: "Partner application questions",
      createdById: admin.id,
      published: true,
      publicToken: "seed-partner-application-form",
    },
  });
  // One version, replaced on re-seed so question edits take effect.
  await prisma.formVersion.deleteMany({ where: { formId: partnerAppForm.id } });
  await prisma.formVersion.create({
    data: {
      formId: partnerAppForm.id,
      versionNumber: 1,
      createdById: admin.id,
      intro: "Thank you for your interest in working with DALI! Please answer the following questions to the best of your ability — detailed answers help us evaluate how the DALI Lab could best work with you. We evaluate projects on five categories: positive social or environmental impact; appropriate and interesting design and development challenges; a passionate and committed founding team; feasibility; and originality / opportunity for innovation. Questions? Email partners@dali.dartmouth.edu.",
      questions: [
  {
    "key": "break-general",
    "type": "pageBreak",
    "required": false,
    "data": {
      "label": "General Information"
    }
  },
  {
    "key": "project-title",
    "type": "text",
    "required": true,
    "data": {
      "label": "Project title"
    }
  },
  {
    "key": "contact-name",
    "type": "text",
    "required": true,
    "data": {
      "label": "Main contact name"
    }
  },
  {
    "key": "contact-phone",
    "type": "text",
    "required": true,
    "data": {
      "label": "Main contact phone number"
    }
  },
  {
    "key": "contact-email",
    "type": "text",
    "required": true,
    "data": {
      "label": "Main contact email"
    }
  },
  {
    "key": "legal-entity-name",
    "type": "text",
    "required": true,
    "data": {
      "label": "Legal entity name"
    }
  },
  {
    "key": "legal-entity-address",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Legal entity address"
    }
  },
  {
    "key": "internal-reference",
    "type": "text",
    "required": false,
    "data": {
      "label": "Internal reference",
      "description": "if applicable"
    }
  },
  {
    "key": "team-members",
    "type": "textarea",
    "required": false,
    "data": {
      "label": "Team members"
    }
  },
  {
    "key": "preferred-start-dates",
    "type": "checkbox",
    "required": true,
    "data": {
      "label": "Preferred start dates",
      "options": [
        "No preference",
        "Fall (September start)",
        "Winter (January start)",
        "Spring (April start)"
      ]
    }
  },
  {
    "key": "affiliation",
    "type": "text",
    "required": true,
    "data": {
      "label": "What best describes your affiliation?"
    }
  },
  {
    "key": "website",
    "type": "text",
    "required": false,
    "data": {
      "label": "Website (if applicable)"
    }
  },
  {
    "key": "break-problem",
    "type": "pageBreak",
    "required": false,
    "data": {
      "label": "Part 1: The Problem",
      "description": "Please complete the prompts to the best of your ability. Ideally, answers are 1–2 paragraphs — but the more detail, the better."
    }
  },
  {
    "key": "problem",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Briefly describe the problem you are solving"
    }
  },
  {
    "key": "solution",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "What is your proposed solution(s) / idea?"
    }
  },
  {
    "key": "differentiation",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "How is your project different from other existing similar solutions?"
    }
  },
  {
    "key": "users",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Who will use this product?",
      "description": "Give multiple, specific examples of users and stakeholder groups."
    }
  },
  {
    "key": "impact-who",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Who does your project impact and how?"
    }
  },
  {
    "key": "long-term-impact",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "What do you envision are the long-term impacts of this project?"
    }
  },
  {
    "key": "break-existing",
    "type": "pageBreak",
    "required": false,
    "data": {
      "label": "Part 2: Existing Work"
    }
  },
  {
    "key": "stage",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "At what stage is the project / idea?"
    }
  },
  {
    "key": "user-research",
    "type": "textarea",
    "required": false,
    "data": {
      "label": "Have you spoken with potential users of your solution and researched their needs?",
      "description": "If so, briefly describe your approach and findings, and the most recent user feedback."
    }
  },
  {
    "key": "competitive-research",
    "type": "textarea",
    "required": false,
    "data": {
      "label": "What previous competitive research has been done on the project?",
      "description": "if any"
    }
  },
  {
    "key": "content-data",
    "type": "textarea",
    "required": false,
    "data": {
      "label": "What content or data will your project need? Do you own it? If not, what access do you have?",
      "description": "If it has yet to be created, please describe the plans for creation."
    }
  },
  {
    "key": "timeline",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "What is your project timeline?",
      "description": "Briefly describe your timeline, in particular any go-to-market ideas if applicable."
    }
  },
  {
    "key": "break-collaboration",
    "type": "pageBreak",
    "required": false,
    "data": {
      "label": "Part 3: Collaboration with DALI"
    }
  },
  {
    "key": "why-dali",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Why DALI?"
    }
  },
  {
    "key": "dali-help",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Which aspects of the project would you like to enlist DALI's help?"
    }
  },
  {
    "key": "funding",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Describe any funding available to you to support this project."
    }
  },
  {
    "key": "how-heard",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "How did you learn about the DALI Lab?"
    }
  },
  {
    "key": "time-pressure",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Is this project under any time pressure or restrictions?",
      "description": "If so, please explain or provide a hard-stop for DALI's contribution."
    }
  },
  {
    "key": "anything-else",
    "type": "textarea",
    "required": false,
    "data": {
      "label": "Is there anything else we should know when evaluating this project?"
    }
  },
  {
    "key": "attachments-info",
    "type": "info",
    "required": false,
    "data": {
      "label": "",
      "body": "Attachments (optional). Upload any relevant documents or material that provide further detail or clarity to help us evaluate your application."
    }
  },
  {
    "key": "file-1",
    "type": "file",
    "required": false,
    "data": {
      "label": "File 1"
    }
  },
  {
    "key": "file-2",
    "type": "file",
    "required": false,
    "data": {
      "label": "File 2"
    }
  },
  {
    "key": "file-3",
    "type": "file",
    "required": false,
    "data": {
      "label": "File 3"
    }
  }
] as object,
    },
  });
  await prisma.partnerApplicationFormBinding.deleteMany({});
  await prisma.partnerApplicationFormBinding.create({
    data: { formId: partnerAppForm.id, updatedById: admin.id },
  });
  console.log("  partner application form bound (form-partner-application)");

  // ── Staffing cycle + preferences ───────────────────────────────────────────
  // Demo data for the /projects/staffing board. Staffing is always open —
  // one cycle per term (StaffingCycle.termId is unique), keyed here on 26S.
  // Stable id (cycle-26s-default) keeps re-runs idempotent.
  if (term26S) {
    const cycle = await prisma.staffingCycle.upsert({
      where: { termId: term26S.id },
      update: { name: "26S Staffing" },
      create: {
        id: "cycle-26s-default",
        termId: term26S.id,
        name: "26S Staffing",
      },
    });

    // Make the admin a Staffing Lead so they can use the board. Idempotent.
    const existingStaffingCore = await prisma.coreAssignment.findFirst({
      where: { userId: admin.id, termId: term26S.id, leadTitle: "Staffing Lead" },
    });
    if (!existingStaffingCore) {
      await prisma.coreAssignment.create({
        data: { userId: admin.id, termId: term26S.id, leadTitle: "Staffing Lead" },
      });
    }

    // Pool of project ids — only Active/Paused projects are biddable.
    const biddableProjects = projectSeeds
      .filter((p) => p.status !== "Archived")
      .map((p) => p.id);

    // Need at least one domain id to attach to preferences. Pick whichever
    // domain seed.ts already created (Design / Engineering / Product). Falls
    // back gracefully if domain IDs change.
    const someDomain = await prisma.domain.findFirst({ select: { id: true } });
    if (someDomain) {
      // Find every DALIMember user. We bid each of them on a deterministic
      // rotating slice of biddableProjects so the board is non-empty across
      // multiple cycles + projects.
      const memberUsers = await prisma.user.findMany({
        where: { daliMember: { isNot: null } },
        select: { id: true },
        orderBy: { id: "asc" }, // deterministic
      });

      // ── Form-sourced bids ──────────────────────────────────────────────
      // A bid only exists through the cycle's bound Project Bids form. The
      // seed therefore (1) opens role requests so projects are biddable,
      // (2) grants each member eligibility in a domain that has open roles,
      // (3) binds a real Project Bids form, then (4) runs each member's
      // answers through the SAME interpret→validate→replaceBidSet pipeline a
      // live submission uses. This keeps StaffingPreference (and everything
      // derived from it below) populated without any direct write.

      // (1) ProjectRoleRequest must exist BEFORE bids — validateBids rejects a
      // bid whose (term, domain) has no open role. (Moved ahead of bids; the
      // later block that used to create these is now gone.)
      await prisma.projectRoleRequest.deleteMany({ where: { termId: term26S.id } });
      const roleMix = [
        { domainId: engDomain.id, slots: 2 },
        { domainId: designDomain.id, slots: 1 },
        { domainId: pmDomain.id, slots: 1 },
      ];
      const biddableForRoles = projectSeeds.filter((p) => p.status !== "Archived");
      for (const p of biddableForRoles) {
        for (const r of roleMix) {
          await prisma.projectRoleRequest.create({
            data: {
              projectId: p.id,
              termId: term26S.id,
              domainId: r.domainId,
              level: "P1",
              slots: r.slots,
            },
          });
        }
      }

      // (2) Eligibility before bids — validateBids derives the bid's level
      // from the member's DomainEligibility. Everyone gets Engineering (it
      // always has open roles via roleMix), at a rotating level.
      const ELIG_LEVELS = ["P1", "P2", "P3"] as const;
      const bidDomainId = engDomain.id;
      for (const [i, u] of memberUsers.entries()) {
        await prisma.domainEligibility.upsert({
          where: { userId_domainId: { userId: u.id, domainId: bidDomainId } },
          update: { level: ELIG_LEVELS[i % 3], promotedBy: admin.id },
          create: {
            userId: u.id,
            domainId: bidDomainId,
            level: ELIG_LEVELS[i % 3],
            promotedBy: admin.id,
          },
        });
      }

      // (3) The bound Project Bids form: 3 ranked (project, domain, notes)
      // groups. The form is flexible; a saved column mapping (built below)
      // tells the interpreter which question is which. Project questions use
      // "projects:open-this-term" and domain "domains:active" so their answers
      // are real ids. Stable ids keep the seed idempotent.
      const bidQuestions: Question[] = [1, 2, 3].flatMap((rank) => [
        {
          key: `bid-${rank}-project`,
          type: "reference" as const,
          required: rank === 1,
          data: {
            label: `Choice ${rank}: Project`,
            referenceSource: "projects:open-this-term",
          },
        },
        {
          key: `bid-${rank}-domain`,
          type: "reference" as const,
          required: rank === 1,
          data: {
            label: `Choice ${rank}: Domain`,
            referenceSource: "domains:active",
          },
        },
        {
          key: `bid-${rank}-notes`,
          type: "textarea" as const,
          required: false,
          data: { label: `Choice ${rank}: Notes (optional)` },
        },
      ]);

      // The saved column mapping: which question fills each ranked column.
      // Order of project entries = bid rank (matches interpreter grouping).
      const bidMapping = {
        version: 1 as const,
        entries: [1, 2, 3].flatMap((rank) => [
          {
            source: "question" as const,
            questionKey: `bid-${rank}-project`,
            role: "project",
            label: `Choice ${rank} project`,
          },
          {
            source: "question" as const,
            questionKey: `bid-${rank}-domain`,
            role: "domain",
            label: `Choice ${rank} domain`,
          },
          {
            source: "question" as const,
            questionKey: `bid-${rank}-notes`,
            role: "notes",
            label: `Choice ${rank} notes`,
          },
        ]),
      };

      const bidForm = await prisma.form.upsert({
        where: { id: "form-project-bids-26s" },
        update: { published: true },
        create: {
          id: "form-project-bids-26s",
          name: "26S Project Bids",
          createdById: admin.id,
          published: true,
          publicToken: "seed-project-bids-26s",
        },
      });
      // One version, replaced on re-seed so question edits take effect.
      await prisma.formVersion.deleteMany({ where: { formId: bidForm.id } });
      const bidFormVersion = await prisma.formVersion.create({
        data: {
          formId: bidForm.id,
          versionNumber: 1,
          questions: bidQuestions as object,
          createdById: admin.id,
        },
      });
      await prisma.staffingCycleFormBinding.upsert({
        where: {
          staffingCycleId_slot: {
            staffingCycleId: cycle.id,
            slot: "project-bids",
          },
        },
        update: {
          formId: bidForm.id,
          updatedById: admin.id,
          columnMapping: bidMapping as object,
        },
        create: {
          staffingCycleId: cycle.id,
          slot: "project-bids",
          formId: bidForm.id,
          updatedById: admin.id,
          columnMapping: bidMapping as object,
        },
      });

      // (4) Idempotency: clear this cycle's prefs + prior seeded form
      // submissions, then replay each member's answers through the real
      // pipeline.
      await prisma.staffingPreference.deleteMany({
        where: { staffingCycleId: cycle.id },
      });
      await prisma.formSubmission.deleteMany({
        where: { staffingCycleId: cycle.id, slot: "project-bids" },
      });

      const bidCycle = {
        id: cycle.id,
        termId: term26S.id,
        maxPreferencesPerMember: cycle.maxPreferencesPerMember,
      };
      let prefCount = 0;
      let bidderCount = 0;
      for (const [i, u] of memberUsers.entries()) {
        // 3 ranked picks rotating through biddable projects, all in the
        // Engineering domain the member is eligible in.
        const answers: Record<string, unknown> = {};
        for (let rank = 1; rank <= 3; rank++) {
          const projectId =
            biddableProjects[(i + rank - 1) % biddableProjects.length];
          answers[`bid-${rank}-project`] = projectId;
          answers[`bid-${rank}-domain`] = bidDomainId;
          answers[`bid-${rank}-notes`] =
            rank === 1
              ? "Excited about this team — strong fit with prior work."
              : rank === 2
                ? "Solid second choice; would learn a lot here."
                : "";
        }

        const interpreted = interpretBidForm(answers, bidMapping);
        if (!interpreted.ok) {
          throw new Error(
            `Seed: bid form interpret failed for ${u.id}: ${interpreted.error}`,
          );
        }
        const validated = await validateBids(u.id, bidCycle, interpreted.bids);
        if (!validated.ok) {
          throw new Error(
            `Seed: bid validation failed for ${u.id}: ${validated.error}`,
          );
        }

        await prisma.$transaction(async (tx) => {
          await tx.formSubmission.create({
            data: {
              formId: bidForm.id,
              formVersionId: bidFormVersion.id,
              userId: u.id,
              staffingCycleId: cycle.id,
              slot: "project-bids",
              answers: answers as object,
            },
          });
          await replaceBidSet(tx, u.id, cycle.id, validated.bids);
        });
        prefCount += validated.bids.length;
        bidderCount++;
      }
      console.log(`  1 staffing cycle (Open), bound Project Bids form, ${bidderCount} members bidding via form, ${prefCount} preferences`);

      // ── Intent to Work: bound form + per-term mapping, same pattern ────────
      // One availability question for the cycle's term. The saved mapping
      // ties that question to the intent-status role for term26S; submissions
      // replay through the real interpret → replaceIntentSet pipeline.
      const intentQuestions: Question[] = [
        {
          key: "itw-status",
          type: "select" as const,
          required: true,
          data: {
            label: "Will you be working at the lab in 26S?",
            options: ["Returning", "Not this term", "Graduating", "On leave", "Unsure"],
          },
        },
      ];
      const intentMapping = {
        version: 1 as const,
        entries: [
          {
            source: "question" as const,
            questionKey: "itw-status",
            role: "intent-status",
            label: "26S availability",
            termId: term26S.id,
          },
        ],
      };
      const intentForm = await prisma.form.upsert({
        where: { id: "form-intent-to-work-26s" },
        update: { published: true },
        create: {
          id: "form-intent-to-work-26s",
          name: "26S Intent to Work",
          createdById: admin.id,
          published: true,
          publicToken: "seed-intent-to-work-26s",
        },
      });
      await prisma.formVersion.deleteMany({ where: { formId: intentForm.id } });
      const intentFormVersion = await prisma.formVersion.create({
        data: {
          formId: intentForm.id,
          versionNumber: 1,
          questions: intentQuestions as object,
          createdById: admin.id,
        },
      });
      await prisma.staffingCycleFormBinding.upsert({
        where: {
          staffingCycleId_slot: {
            staffingCycleId: cycle.id,
            slot: "intent-to-work",
          },
        },
        update: {
          formId: intentForm.id,
          updatedById: admin.id,
          columnMapping: intentMapping as object,
        },
        create: {
          staffingCycleId: cycle.id,
          slot: "intent-to-work",
          formId: intentForm.id,
          updatedById: admin.id,
          columnMapping: intentMapping as object,
        },
      });
      await prisma.intentToWork.deleteMany({
        where: { staffingCycleId: cycle.id },
      });
      await prisma.formSubmission.deleteMany({
        where: { staffingCycleId: cycle.id, slot: "intent-to-work" },
      });
      const INTENT_ROTATION = ["Returning", "Unsure", "Not this term"];
      let intentCount = 0;
      for (const [i, u] of memberUsers.entries()) {
        const answers = { "itw-status": INTENT_ROTATION[i % 3] };
        const interpreted = interpretIntentForm(answers, intentMapping, [
          term26S.id,
        ]);
        if (!interpreted.ok) {
          throw new Error(
            `Seed: intent interpret failed for ${u.id}: ${interpreted.error}`,
          );
        }
        await prisma.$transaction(async (tx) => {
          await tx.formSubmission.create({
            data: {
              formId: intentForm.id,
              formVersionId: intentFormVersion.id,
              userId: u.id,
              staffingCycleId: cycle.id,
              slot: "intent-to-work",
              answers: answers as object,
            },
          });
          await replaceIntentSet(tx, u.id, cycle.id, interpreted.rows);
        });
        intentCount++;
      }
      console.log(`  bound Intent to Work form, ${intentCount} members' intent via form`);

      // ── Derived assignments + remaining v0 models ──────────────────────────
      // Demo rows for every still-empty v0 model so list/detail pages that
      // read them aren't blank. Idempotent: we delete-then-recreate the rows
      // this block owns for the seeded term/cycle.
      const dali = await prisma.project.findUnique({
        where: { id: "project-dali-os" },
        select: { id: true },
      });
      const biddable = projectSeeds.filter((p) => p.status !== "Archived");

      // DomainEligibility + ProjectAssignment derived from each member's #1
      // bid (preferenceRank=1). Eligibility is one-per-(user,domain); the
      // assignment mirrors the project they bid highest. Coherent with the
      // staffing board's proposed state.
      const rank1Prefs = await prisma.staffingPreference.findMany({
        where: { staffingCycleId: cycle.id, preferenceRank: 1 },
        select: { userId: true, projectId: true, domainId: true, level: true },
      });
      await prisma.projectAssignment.deleteMany({ where: { termId: term26S.id } });
      let eligCount = 0;
      let assignCount = 0;
      for (const p of rank1Prefs) {
        await prisma.domainEligibility.upsert({
          where: { userId_domainId: { userId: p.userId, domainId: p.domainId } },
          update: { level: p.level, promotedBy: admin.id },
          create: {
            userId: p.userId,
            domainId: p.domainId,
            level: p.level,
            promotedBy: admin.id,
          },
        });
        eligCount++;
        await prisma.projectAssignment.create({
          data: {
            userId: p.userId,
            projectId: p.projectId,
            termId: term26S.id,
            domainId: p.domainId,
            level: p.level,
          },
        });
        assignCount++;
      }

      // ProjectTermStatus: every Active/Paused project continues into 26S.
      for (const p of biddable) {
        await prisma.projectTermStatus.upsert({
          where: { projectId_termId: { projectId: p.id, termId: term26S.id } },
          update: { isContinuing: true, setBy: admin.id },
          create: {
            projectId: p.id,
            termId: term26S.id,
            isContinuing: true,
            setBy: admin.id,
          },
        });
      }

      // (ProjectRoleRequest is now created earlier, before bids, since
      // validateBids depends on open roles existing. See step (1) above.)

      // StaffingAssignment: proposed rows mirroring the derived assignments
      // so the staffing board shows in-flight proposals on a fresh seed.
      await prisma.staffingAssignment.deleteMany({
        where: { staffingCycleId: cycle.id },
      });
      for (const p of rank1Prefs) {
        await prisma.staffingAssignment.create({
          data: {
            userId: p.userId,
            staffingCycleId: cycle.id,
            projectId: p.projectId,
            termId: term26S.id,
            domainId: p.domainId,
            level: p.level,
            status: "Proposed",
            assignedById: admin.id,
          },
        });
      }

      // EssentialityForm + ratings: one PM form on DALI OS rating the first
      // few members.
      if (dali) {
        const form = await prisma.essentialityForm.upsert({
          where: {
            projectId_staffingCycleId: { projectId: dali.id, staffingCycleId: cycle.id },
          },
          update: { pmUserId: admin.id },
          create: {
            projectId: dali.id,
            staffingCycleId: cycle.id,
            pmUserId: admin.id,
            submittedAt: new Date("2026-03-18"),
          },
        });
        const ratingLevels = ["Critical", "Important", "NiceToHave"] as const;
        for (const [i, u] of memberUsers.slice(0, 3).entries()) {
          await prisma.essentialityRating.upsert({
            where: {
              essentialityFormId_userId: { essentialityFormId: form.id, userId: u.id },
            },
            update: { rating: ratingLevels[i] },
            create: { essentialityFormId: form.id, userId: u.id, rating: ratingLevels[i] },
          });
        }
      }

      // Project workspace: one Epic → Sprint → Task chain on DALI OS.
      if (dali) {
        await prisma.task.deleteMany({ where: { projectId: dali.id } });
        await prisma.sprint.deleteMany({ where: { projectId: dali.id } });
        await prisma.epic.deleteMany({ where: { projectId: dali.id } });
        const epic = await prisma.epic.create({
          data: { projectId: dali.id, title: "Staffing board v1", position: 0 },
        });
        // Relative dates: an Active demo sprint must genuinely span "now" or
        // the sprint-lifecycle job auto-closes it on the first tick.
        const sprint = await prisma.sprint.create({
          data: {
            projectId: dali.id,
            epicId: epic.id,
            name: "Sprint 1",
            startsAt: new Date(Date.now() - 7 * 86_400_000),
            endsAt: new Date(Date.now() + 7 * 86_400_000),
            status: "Active",
          },
        });
        await prisma.task.create({
          data: {
            projectId: dali.id,
            sprintId: sprint.id,
            epicId: epic.id,
            title: "Drag-and-drop columns",
            status: "InProgress",
            createdById: admin.id,
          },
        });
        await prisma.task.create({
          data: {
            projectId: dali.id,
            title: "Backlog: confirm → ProjectAssignment promotion",
            createdById: admin.id,
          },
        });
      }

      // MentorshipPair + MentorNote: pair the first two members (mentor →
      // mentee) on their shared rank-1 project context.
      if (memberUsers.length >= 2) {
        const mentor = memberUsers[0];
        const mentee = memberUsers[1];
        const mentorPref = rank1Prefs.find((p) => p.userId === mentor.id);
        if (mentorPref) {
          await prisma.mentorshipPair.deleteMany({
            where: { mentorUserId: mentor.id, termId: term26S.id },
          });
          await prisma.mentorshipPair.create({
            data: {
              menteeUserId: mentee.id,
              mentorUserId: mentor.id,
              projectId: mentorPref.projectId,
              termId: term26S.id,
              domainId: mentorPref.domainId,
            },
          });
          await prisma.mentorNote.upsert({
            where: {
              mentorId_menteeId_projectId_termId_domainId_weekOf: {
                mentorId: mentor.id,
                menteeId: mentee.id,
                projectId: mentorPref.projectId,
                termId: term26S.id,
                domainId: mentorPref.domainId,
                weekOf: new Date("2026-03-30"),
              },
            },
            update: {},
            create: {
              mentorId: mentor.id,
              menteeId: mentee.id,
              projectId: mentorPref.projectId,
              termId: term26S.id,
              domainId: mentorPref.domainId,
              weekOf: new Date("2026-03-30"),
              contentJson: { type: "doc", content: [] },
            },
          });
        }
      }

      // Account-first: one external PartnerContact (the person) with a
      // PartnerMembership in the Tuck org. PartnerUser is retired.
      const tuck = await prisma.partnerOrg.findUnique({
        where: { id: "partner-tuck-school" },
        select: { id: true },
      });
      if (tuck) {
        const partnerUserRow = await prisma.user.upsert({
          where: { personalEmail: "partner.tuck@example.com" },
          update: { firstName: "Pat", lastName: "Tuck" },
          create: {
            personalEmail: "partner.tuck@example.com",
            firstName: "Pat",
            lastName: "Tuck",
          },
        });
        const tuckContact = await prisma.partnerContact.upsert({
          where: { email: "partner.tuck@example.com" },
          update: { userId: partnerUserRow.id, name: "Pat Tuck", authProvider: "MagicLink" },
          create: {
            email: "partner.tuck@example.com",
            userId: partnerUserRow.id,
            name: "Pat Tuck",
            authProvider: "MagicLink",
          },
        });
        const tuckMembership = await prisma.partnerMembership.upsert({
          where: { contactId_orgId: { contactId: tuckContact.id, orgId: tuck.id } },
          update: { role: "Program Sponsor" },
          create: {
            contactId: tuckContact.id,
            orgId: tuck.id,
            role: "Program Sponsor",
          },
        });
        // Self-signup sets the founder as primary contact; mirror that so the
        // seeded org shows the "Primary contact" badge in settings.
        await prisma.partnerOrg.update({
          where: { id: tuck.id },
          data: { primaryContactId: tuckMembership.id },
        });

        // A pending teammate invite with a deterministic token so E2E can
        // drive /partner/invite/:token without email. Raw token:
        // "e2e-partner-invite-token" (sha256 → base64url below).
        const { createHash } = await import("node:crypto");
        const inviteHash = createHash("sha256")
          .update("e2e-partner-invite-token")
          .digest("base64url");
        await prisma.partnerInvite.upsert({
          where: { tokenHash: inviteHash },
          update: {
            acceptedAt: null,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
          create: {
            partnerOrgId: tuck.id,
            email: "invitee.tuck@example.com",
            displayRole: "Design Lead",
            tokenHash: inviteHash,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
      }

      // Second partner org contact (Hood) — exercises the cross-org 404s.
      const hood = await prisma.partnerOrg.findUnique({
        where: { id: "partner-hood-museum" },
        select: { id: true },
      });
      if (hood) {
        const hoodUser = await prisma.user.upsert({
          where: { personalEmail: "partner.hood@example.com" },
          update: { firstName: "Harper", lastName: "Hood" },
          create: {
            personalEmail: "partner.hood@example.com",
            firstName: "Harper",
            lastName: "Hood",
          },
        });
        const hoodContact = await prisma.partnerContact.upsert({
          where: { email: "partner.hood@example.com" },
          update: { userId: hoodUser.id, name: "Harper Hood", authProvider: "MagicLink" },
          create: {
            email: "partner.hood@example.com",
            userId: hoodUser.id,
            name: "Harper Hood",
            authProvider: "MagicLink",
          },
        });
        await prisma.partnerMembership.upsert({
          where: { contactId_orgId: { contactId: hoodContact.id, orgId: hood.id } },
          update: { role: "Curator" },
          create: {
            contactId: hoodContact.id,
            orgId: hood.id,
            role: "Curator",
          },
        });
      }

      // Partner-portal demo data on Pat Tuck's project: an active sprint with
      // mixed task statuses (sprint summary), a planned next sprint, and a
      // shared + an internal page (share-toggle / partner-page visibility).
      const tuckProject = await prisma.project.findUnique({
        where: { id: "project-tuck-alumni" },
        select: { id: true },
      });
      if (tuckProject) {
        await prisma.task.deleteMany({ where: { projectId: tuckProject.id } });
        await prisma.sprint.deleteMany({ where: { projectId: tuckProject.id } });
        // Relative dates, same reason as Sprint 1 above: Active must span
        // "now" or the sprint-lifecycle job closes it out from under the
        // partner-portal e2e expectations.
        const tuckSprint = await prisma.sprint.create({
          data: {
            projectId: tuckProject.id,
            name: "Sprint 3 — Matching flow",
            startsAt: new Date(Date.now() - 7 * 86_400_000),
            endsAt: new Date(Date.now() + 7 * 86_400_000),
            status: "Active",
          },
        });
        await prisma.sprint.create({
          data: {
            projectId: tuckProject.id,
            name: "Sprint 4 — Notifications",
            startsAt: new Date(Date.now() + 7 * 86_400_000),
            endsAt: new Date(Date.now() + 21 * 86_400_000),
            status: "Planned",
          },
        });
        const tuckTasks: {
          title: string;
          status: "Todo" | "InProgress" | "Done";
        }[] = [
          { title: "Mentor matching algorithm v1", status: "Done" },
          { title: "Alumni profile import", status: "Done" },
          { title: "Match review screen", status: "InProgress" },
          { title: "Email digest opt-in", status: "Todo" },
          { title: "Load-test matching queue", status: "Todo" },
        ];
        for (const t of tuckTasks) {
          await prisma.task.create({
            data: {
              projectId: tuckProject.id,
              sprintId: tuckSprint.id,
              title: t.title,
              status: t.status,
              createdById: admin.id,
            },
          });
        }

        // Pages: idempotent by (workspace, title) since Page ids are cuids.
        const seedPage = async (title: string, partnerVisible: boolean) => {
          const existing = await prisma.page.findFirst({
            where: {
              workspaceType: "Project",
              workspaceId: tuckProject.id,
              title,
            },
            select: { id: true },
          });
          if (existing) {
            await prisma.page.update({
              where: { id: existing.id },
              data: { partnerVisible, archivedAt: null },
            });
          } else {
            await prisma.page.create({
              data: {
                workspaceType: "Project",
                workspaceId: tuckProject.id,
                title,
                partnerVisible,
                createdById: admin.id,
              },
            });
          }
        };
        await seedPage("Weekly Partner Update", true);
        await seedPage("Internal Retro Notes", false);
      }

      // Mentor-note template (idempotent by isDefault). Document templates are
      // ordinary Lab pages flagged isTemplate now, created in-app — not seeded.
      const existingMentorTpl = await prisma.mentorNoteTemplate.findFirst({
        where: { isDefault: true },
        select: { id: true },
      });
      if (!existingMentorTpl) {
        await prisma.mentorNoteTemplate.create({
          data: {
            name: "Weekly Mentor Note",
            contentJson: {
              type: "doc",
              content: [
                {
                  type: "heading",
                  attrs: { level: 3 },
                  content: [{ type: "text", text: "Wins" }],
                },
                { type: "paragraph" },
                {
                  type: "heading",
                  attrs: { level: 3 },
                  content: [{ type: "text", text: "Blockers" }],
                },
                { type: "paragraph" },
                {
                  type: "heading",
                  attrs: { level: 3 },
                  content: [{ type: "text", text: "Follow-ups" }],
                },
                { type: "paragraph" },
              ],
            },
            isDefault: true,
          },
        });
      }

      // EducationOffering + InstructorAssignment: one published miniseries
      // with an open registration window (review-required apply flow).
      const offering = await prisma.educationOffering.upsert({
        where: { id: "offering-react-miniseries" },
        update: {
          title: "Intro to React",
          registrationClosesAt: new Date("2027-05-01"),
          startsAt: new Date("2027-05-02"),
          endsAt: new Date("2027-06-15"),
        },
        create: {
          id: "offering-react-miniseries",
          type: "Miniseries",
          title: "Intro to React",
          capacity: 25,
          registrationOpensAt: new Date("2026-03-01"),
          registrationClosesAt: new Date("2027-05-01"),
          startsAt: new Date("2027-05-02"),
          endsAt: new Date("2027-06-15"),
          status: "Published",
          requiresReview: true,
          descriptionDocId: "eduoffering:offering-react-miniseries:description",
        },
      });
      await prisma.educationSession.upsert({
        where: { id: "session-react-1" },
        update: {},
        create: {
          id: "session-react-1",
          offeringId: "offering-react-miniseries",
          sequence: 1,
          datetime: new Date("2027-05-04T18:00:00Z"),
          location: "DALI Space",
        },
      });
      await prisma.instructorAssignment.upsert({
        where: {
          userId_offeringId_termId: {
            userId: admin.id,
            offeringId: offering.id,
            termId: term26S.id,
          },
        },
        update: {},
        create: { userId: admin.id, offeringId: offering.id, termId: term26S.id },
      });

      // A published RSVP workshop with an open registration window and a tiny
      // capacity, so the auto-approve → waitlist → promotion flow is
      // exercisable straight from the seed (E2E leans on this).
      const workshop = await prisma.educationOffering.upsert({
        where: { id: "offering-figma-workshop" },
        update: { title: "Figma Crash Course" },
        create: {
          id: "offering-figma-workshop",
          type: "Workshop",
          title: "Figma Crash Course",
          capacity: 2,
          registrationOpensAt: new Date("2026-01-01"),
          registrationClosesAt: new Date("2027-06-01"),
          startsAt: new Date("2027-06-02"),
          endsAt: new Date("2027-06-02"),
          status: "Published",
          requiresReview: false,
          descriptionDocId: "eduoffering:offering-figma-workshop:description",
        },
      });
      await prisma.educationSession.upsert({
        where: { id: "session-figma-1" },
        update: {},
        create: {
          id: "session-figma-1",
          offeringId: workshop.id,
          sequence: 1,
          datetime: new Date("2027-06-02T18:00:00Z"),
          location: "Sudikoff 007",
        },
      });
      await prisma.instructorAssignment.upsert({
        where: {
          userId_offeringId_termId: {
            userId: admin.id,
            offeringId: workshop.id,
            termId: term26S.id,
          },
        },
        update: {},
        create: { userId: admin.id, offeringId: workshop.id, termId: term26S.id },
      });
      // Application forms cloned from the education templates (idempotent —
      // both helpers no-op when the folder/form already exists).
      await ensureEducationTemplates(admin.id);
      await createOfferingApplicationForm(offering.id, admin.id);
      await createOfferingApplicationForm(workshop.id, admin.id);

      // Lab-workspace Page + a NotificationPreference row for the admin.
      await prisma.page.deleteMany({
        where: { workspaceType: "Lab", title: "Lab Handbook" },
      });
      await prisma.page.create({
        data: {
          workspaceType: "Lab",
          title: "Lab Handbook",
          kind: "FreeForm",
          contentDocId: "page:lab-handbook",
          createdById: admin.id,
        },
      });
      // Exercises the preference shape (eventType from the registry in
      // app/lib/notification-events.ts): admin gets course announcements as
      // a daily digest instead of the Instant default.
      await prisma.notificationPreference.upsert({
        where: {
          userId_eventType: {
            userId: admin.id,
            eventType: "education.announcement",
          },
        },
        update: { digestFrequency: "Daily" },
        create: {
          userId: admin.id,
          eventType: "education.announcement",
          inApp: true,
          slackDm: false,
          digestFrequency: "Daily",
        },
      });

      // JobCodeLookup: the real Dartmouth Job IDs used on TimesheetX exports, so
      // the payroll-reconcile reverse-lookup (jobId → assignmentType/level/rate)
      // resolves against the same identifiers prod carries. 4834 maps to BOTH P1
      // and P2 (a Job ID is a category-level classifier — the precise level +
      // wage come from the person's ProjectAssignment).
      const jobCodeIds = ["4834", "4889", "4890", "7523"];
      await prisma.jobCodeLookup.deleteMany({
        where: {
          jobCode: { in: [...jobCodeIds, "DALI-PROJ-P1", "DALI-CORE"] },
        },
      });
      await prisma.jobCodeLookup.createMany({
        data: [
          { assignmentType: "Project", level: "P1", jobCode: "4834", payRateUsdHour: 16.25 },
          { assignmentType: "Project", level: "P2", jobCode: "4834", payRateUsdHour: 17.0 },
          { assignmentType: "Project", level: "P3", jobCode: "4889", payRateUsdHour: 18.0 },
          { assignmentType: "Core", jobCode: "4890", payRateUsdHour: 20.0 },
          { assignmentType: "Instructor", jobCode: "7523", payRateUsdHour: 19.0 },
        ],
      });

      // Payroll-reconcile fixture: a student with a netId, a chart string on the
      // DALI OS project, and an explicit ProjectAssignment in the active term so
      // an uploaded timesheet (netId + jobId 4834) reconciles to a Payroll Data
      // row. The bid-derived assignments above are members-by-daliEmail (no
      // netId), so the reconcile join needs this deterministic netId'd student.
      const payrollChartString = "18.722.161028.128512.4000";
      if (dali) {
        await prisma.project.update({
          where: { id: dali.id },
          data: { chartString: payrollChartString },
        });
        const payrollStudent = await prisma.user.upsert({
          where: { netId: "f00pay01" },
          update: { firstName: "Ada", lastName: "Lovelace", handle: "adalovelace" },
          create: {
            netId: "f00pay01",
            firstName: "Ada",
            lastName: "Lovelace",
            handle: "adalovelace",
            daliMember: { create: {} },
          },
        });
        await prisma.projectAssignment.upsert({
          where: {
            userId_projectId_termId_domainId: {
              userId: payrollStudent.id,
              projectId: dali.id,
              termId: term26S.id,
              domainId: engDomain.id,
            },
          },
          update: { level: "P1" },
          create: {
            userId: payrollStudent.id,
            projectId: dali.id,
            termId: term26S.id,
            domainId: engDomain.id,
            level: "P1",
          },
        });
      }

      console.log(
        `  v0 demo rows: ${eligCount} eligibilities, ${assignCount} project assignments, ` +
          `+ term-status / role-requests / staffing-assignments / essentiality / ` +
          `epic-sprint-task / mentorship / partner-user / partner-portal-demo / templates / offering / ` +
          `page / notifications / job-codes`,
      );
    }
  }

  // MCP OAuth clients are no longer seeded — clients register themselves
  // via RFC 7591 Dynamic Client Registration at /oauth/register.

  // Default system-managed user groups: one per Term/Project/Domain + Core.
  // Idempotent; safe to re-run.
  await syncDefaultGroups();

  // Re-run now that the Core group exists (and thus the Core drive can be
  // provisioned): converges the education templates into the managed
  // Core ▸ Templates ▸ Education folder and archives the loose legacy folder the
  // earlier call created before syncDefaultGroups.
  await ensureEducationTemplates(admin.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
