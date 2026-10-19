/**
 * Demo content for Partners (/core/partners).
 *
 * The base seed gives the board three applications and leaves the CRM fields
 * on orgs and contacts empty. This fills every column of the board, the org
 * and contact records, the evaluation and finance tabs, and gives the reports
 * page enough history to draw a funnel, cycle times, and rejection reasons.
 *
 * Idempotent: every row is upserted on a stable id or natural key.
 */
import type { PrismaClient, Prisma } from "../../app/generated/prisma/client.js";

const DAY = 86_400_000;

type Stage = "Backlog" | "New" | "Interview" | "Accepted" | "Rejected";

type AppSeed = {
  id: string;
  title: string;
  orgId: string;
  contactEmail: string;
  summary: string;
  stage: Stage;
  source: "Email" | "Form" | "Referral" | "Manual" | "Renewal";
  createdDaysAgo: number;
  /** Stage moves after creation, as [daysAgo, to]. Drives cycle-time reports. */
  moves: [number, Stage][];
  lastActivityDaysAgo: number;
  domains: { code: "UIUX" | "Fullstack" | "PM"; members: number; challenges: string }[];
  nextStep?: string;
  nextStepDueInDays?: number;
  holdUntilInDays?: number;
  rejectReason?: "NotAFit" | "NoCapacity" | "Funding" | "Timing" | "Withdrawn" | "Other";
  decisionReason?: string;
  interviewRating?: number;
  ambiguityRating?: number;
  evalRubric?: Record<string, number | string>;
  fundingType?: "DALI_GL" | "TRANSFER_GL" | "DALI_PTAEO" | "OTHER_PTAEO";
  feeCents?: number;
  legalEntityName?: string;
  legalEntityAddress?: string;
  paymentSchedule?: string;
  sowState?: "Draft" | "Shared" | "Accepted";
  meetingRequestedDaysAgo?: number;
  resultingProjectId?: string;
  notes?: [number, string][];
};

const ORG_FIELDS: Record<
  string,
  {
    type: "DartmouthDepartment" | "FacultyResearch" | "Startup" | "Nonprofit" | "Company" | "Alumni" | "Other";
    address?: string;
    legalEntityName?: string;
    tags: string[];
    notes?: string;
    showcaseConsent: boolean;
  }
> = {
  "partner-tuck-school": {
    type: "DartmouthDepartment",
    address: "100 Tuck Hall, Hanover, NH 03755",
    legalEntityName: "Trustees of Dartmouth College (Tuck School of Business)",
    tags: ["returning", "alumni-network"],
    notes: "Third engagement. Program office signs off on scope; budget sits with the dean's office.",
    showcaseConsent: true,
  },
  "partner-hood-museum": {
    type: "DartmouthDepartment",
    address: "6 E Wheelock St, Hanover, NH 03755",
    legalEntityName: "Trustees of Dartmouth College (Hood Museum of Art)",
    tags: ["arts", "on-site-install"],
    notes: "Curatorial calendar is tight in fall. Installs need facilities sign-off two weeks ahead.",
    showcaseConsent: true,
  },
  "partner-thayer": {
    type: "DartmouthDepartment",
    address: "15 Thayer Dr, Hanover, NH 03755",
    tags: ["hardware", "research"],
    showcaseConsent: false,
  },
  "partner-prof-rocket": {
    type: "FacultyResearch",
    tags: ["robotics", "grant-funded"],
    notes: "NSF grant covers the fee. Prefers async updates over meetings.",
    showcaseConsent: true,
  },
  "partner-dali-internal": {
    type: "Other",
    tags: ["internal"],
    showcaseConsent: true,
  },
};

const NEW_ORGS = [
  {
    id: "partner-upper-valley-haven",
    name: "Upper Valley Haven",
    website: "https://uvhaven.org",
    type: "Nonprofit" as const,
    address: "713 Hartford Ave, White River Junction, VT 05001",
    legalEntityName: "The Upper Valley Haven, Inc.",
    tags: ["community", "fee-waived"],
    notes: "Fee waived under the community partner program.",
    showcaseConsent: true,
  },
  {
    id: "partner-greenline",
    name: "Greenline Robotics",
    website: "https://greenline.example.com",
    type: "Startup" as const,
    address: "2 Lebanon St, Hanover, NH 03755",
    legalEntityName: "Greenline Robotics LLC",
    tags: ["startup", "hardware"],
    showcaseConsent: false,
  },
  {
    id: "partner-hypertherm",
    name: "Hypertherm",
    website: "https://www.hypertherm.com",
    type: "Company" as const,
    address: "71 Heater Rd, Lebanon, NH 03766",
    legalEntityName: "Hypertherm Associates, Inc.",
    tags: ["enterprise", "manufacturing"],
    notes: "Procurement needs a W-9 and a PO before the first invoice.",
    showcaseConsent: false,
  },
  {
    id: "partner-geisel-lab",
    name: "Geisel Sleep Lab",
    website: null,
    type: "FacultyResearch" as const,
    address: "1 Medical Center Dr, Lebanon, NH 03756",
    tags: ["health", "irb"],
    notes: "Anything touching patient data needs IRB review first.",
    showcaseConsent: false,
  },
  {
    id: "partner-alumni-founder",
    name: "Sam Okafor '14",
    website: null,
    type: "Alumni" as const,
    tags: ["alumni"],
    showcaseConsent: true,
    isIndividual: true,
  },
];

const CONTACTS = [
  { email: "partner.tuck@example.com", title: "Director of Alumni Programs", phone: "603-555-0141", linkedinUrl: "https://www.linkedin.com/in/pat-tuck", affiliation: "Tuck School of Business", preferredChannel: "Email" as const, notes: "Replies fastest in the morning." },
  { email: "partner.hood@example.com", title: "Associate Curator", phone: "603-555-0177", affiliation: "Hood Museum of Art", preferredChannel: "Phone" as const },
  { email: "partner-thayer@seed.dali", title: "Lab Manager", affiliation: "Thayer School of Engineering", preferredChannel: "Slack" as const },
  { email: "devin.balkcom@seed.dali", name: "Devin Balkcom", title: "Professor of Computer Science", affiliation: "Dartmouth CS", preferredChannel: "Email" as const, orgId: "partner-prof-rocket", role: "PI" },
  { email: "jordan@uvhaven.example.org", name: "Jordan Reyes", title: "Volunteer Coordinator", phone: "802-555-0110", affiliation: "Upper Valley Haven", preferredChannel: "Phone" as const, orgId: "partner-upper-valley-haven", role: "Program lead" },
  { email: "alex@greenline.example.com", name: "Alex Chen", title: "Co-founder & CEO", linkedinUrl: "https://www.linkedin.com/in/alex-chen-greenline", affiliation: "Greenline Robotics", preferredChannel: "Email" as const, orgId: "partner-greenline", role: "Founder" },
  { email: "morgan@greenline.example.com", name: "Morgan Diaz", title: "Co-founder & CTO", affiliation: "Greenline Robotics", preferredChannel: "Slack" as const, orgId: "partner-greenline", role: "Founder" },
  { email: "riley.park@hypertherm.example.com", name: "Riley Park", title: "Innovation Program Manager", phone: "603-555-0199", affiliation: "Hypertherm", preferredChannel: "Email" as const, orgId: "partner-hypertherm", role: "Sponsor" },
  { email: "casey.lin@hypertherm.example.com", name: "Casey Lin", title: "Procurement Specialist", affiliation: "Hypertherm", preferredChannel: "Email" as const, orgId: "partner-hypertherm", role: "Billing", notes: "Send invoices here, cc Riley." },
  { email: "dr.ng@geisel.example.edu", name: "Dr. Avery Ng", title: "Assistant Professor of Psychiatry", affiliation: "Geisel School of Medicine", preferredChannel: "Email" as const, orgId: "partner-geisel-lab", role: "PI" },
  { email: "sam.okafor@example.com", name: "Sam Okafor", title: "Founder, Trailhead", linkedinUrl: "https://www.linkedin.com/in/samokafor", affiliation: "Dartmouth '14", preferredChannel: "Email" as const, orgId: "partner-alumni-founder", role: "Founder" },
  // A contact who moved on: the membership is ended, so the org record shows a past contact.
  { email: "former.curator@example.com", name: "Quinn Ellis", title: "Former Curator", affiliation: "Hood Museum of Art", preferredChannel: "Email" as const, orgId: "partner-hood-museum", role: "Curator", endedDaysAgo: 120 },
];

const APPS: AppSeed[] = [
  // ── New ──
  {
    id: "papp-haven-volunteers",
    title: "Volunteer shift scheduler",
    orgId: "partner-upper-valley-haven",
    contactEmail: "jordan@uvhaven.example.org",
    summary: "Replace the paper sign-up binder with a shift scheduler volunteers can use from their phones.",
    stage: "New",
    source: "Referral",
    createdDaysAgo: 4,
    moves: [],
    lastActivityDaysAgo: 4,
    domains: [
      { code: "Fullstack", members: 2, challenges: "SMS reminders and a simple admin view." },
      { code: "UIUX", members: 1, challenges: "Works for volunteers of every age and comfort with tech." },
    ],
    nextStep: "Intro call to scope the volunteer roles",
    nextStepDueInDays: 3,
  },
  {
    id: "papp-alumni-trailhead",
    title: "Trailhead trip planner",
    orgId: "partner-alumni-founder",
    contactEmail: "sam.okafor@example.com",
    summary: "A trip planner for outdoor clubs: routes, gear lists, and carpool matching.",
    stage: "Backlog",
    source: "Email",
    createdDaysAgo: 18,
    moves: [[15, "Backlog"]],
    lastActivityDaysAgo: 15,
    domains: [{ code: "Fullstack", members: 3, challenges: "Offline maps and carpool matching." }],
    notes: [[18, "Logged from an inbound email to partners@."], [15, "Parked until Sam has a co-founder on board."]],
  },
  // ── Interview ──
  {
    id: "papp-greenline-fleet",
    title: "Robot fleet dashboard",
    orgId: "partner-greenline",
    contactEmail: "alex@greenline.example.com",
    summary: "Live dashboard for a fleet of sidewalk delivery robots: status, routes, and incident review.",
    stage: "Interview",
    source: "Form",
    createdDaysAgo: 21,
    moves: [[14, "Interview"]],
    lastActivityDaysAgo: 2,
    domains: [
      { code: "Fullstack", members: 3, challenges: "Streaming telemetry and a map view at scale." },
      { code: "UIUX", members: 2, challenges: "Incident review flow for non-technical operators." },
      { code: "PM", members: 1, challenges: "Pin down the MVP with a two-founder team." },
    ],
    interviewRating: 4,
    ambiguityRating: 3,
    evalRubric: { feasibility: 4, impact: 3, originality: 4, learning: 5, devChallenges: 5, designChallenges: 3, partnerTeam: 4, funding: 3, notes: "Strong technical fit. Funding depends on their seed round closing." },
    meetingRequestedDaysAgo: 3,
    nextStep: "Debrief with the interview panel",
    nextStepDueInDays: 2,
  },
  {
    id: "papp-geisel-sleep",
    title: "Sleep diary study app",
    orgId: "partner-geisel-lab",
    contactEmail: "dr.ng@geisel.example.edu",
    summary: "A sleep diary app for a 200-participant study, with reminders and a researcher export.",
    stage: "Interview",
    source: "Manual",
    createdDaysAgo: 40,
    moves: [[33, "Interview"]],
    lastActivityDaysAgo: 22,
    domains: [
      { code: "Fullstack", members: 2, challenges: "Secure storage and a clean CSV export." },
      { code: "UIUX", members: 1, challenges: "A 30-second daily check-in people actually finish." },
    ],
    holdUntilInDays: 20,
    nextStep: "Waiting on IRB approval",
    interviewRating: 3,
    ambiguityRating: 2,
  },
  // ── Accepted ──
  {
    id: "papp-hypertherm-qc",
    title: "Cut quality inspection tool",
    orgId: "partner-hypertherm",
    contactEmail: "riley.park@hypertherm.example.com",
    summary: "Photo-based inspection of plasma cut edges, flagging defects on the shop floor.",
    stage: "Accepted",
    source: "Referral",
    createdDaysAgo: 60,
    moves: [[52, "Interview"], [38, "Accepted"]],
    lastActivityDaysAgo: 5,
    domains: [
      { code: "Fullstack", members: 3, challenges: "Image pipeline and a tablet app for the floor." },
      { code: "UIUX", members: 1, challenges: "Glove-friendly UI in a loud, bright shop." },
      { code: "PM", members: 1, challenges: "Coordinate with plant engineering and IT security." },
    ],
    interviewRating: 5,
    ambiguityRating: 4,
    evalRubric: { feasibility: 4, impact: 4, originality: 5, learning: 5, devChallenges: 5, designChallenges: 4, partnerTeam: 5, funding: 5 },
    fundingType: "TRANSFER_GL",
    feeCents: 2_500_000,
    legalEntityName: "Hypertherm Associates, Inc.",
    legalEntityAddress: "71 Heater Rd, Lebanon, NH 03766",
    paymentSchedule: "50% at kickoff, 50% at final demo",
    sowState: "Accepted",
    nextStep: "Kickoff with the plant team",
    nextStepDueInDays: 9,
  },
  {
    id: "papp-rocket-telemetry-renewal",
    title: "Robotic arm telemetry, year 2",
    orgId: "partner-prof-rocket",
    contactEmail: "devin.balkcom@seed.dali",
    summary: "Renewal: extend the telemetry viewer with replay and anomaly flags.",
    stage: "Accepted",
    source: "Renewal",
    createdDaysAgo: 25,
    moves: [[24, "Interview"], [20, "Accepted"]],
    lastActivityDaysAgo: 6,
    domains: [{ code: "Fullstack", members: 2, challenges: "Replay at 10x speed over hours of sensor data." }],
    fundingType: "OTHER_PTAEO",
    feeCents: 1_200_000,
    paymentSchedule: "Single payment at kickoff",
    sowState: "Shared",
    resultingProjectId: "project-rocket-arm",
    nextStep: "Get the SOW signed",
    nextStepDueInDays: -2,
  },
  // ── Rejected ──
  {
    id: "papp-greenline-landing",
    title: "Marketing site refresh",
    orgId: "partner-greenline",
    contactEmail: "morgan@greenline.example.com",
    summary: "Redesign and rebuild the Greenline marketing site.",
    stage: "Rejected",
    source: "Email",
    createdDaysAgo: 26,
    moves: [[20, "Rejected"]],
    lastActivityDaysAgo: 20,
    domains: [{ code: "UIUX", members: 2, challenges: "Visual refresh." }],
    rejectReason: "NotAFit",
    decisionReason: "A landing page redesign doesn't give students enough to learn. Pointed them to the fleet dashboard idea instead.",
  },
  {
    id: "papp-thayer-inventory",
    title: "Machine shop inventory",
    orgId: "partner-thayer",
    contactEmail: "partner-thayer@seed.dali",
    summary: "Track tools and stock in the Thayer machine shop.",
    stage: "Rejected",
    source: "Form",
    createdDaysAgo: 40,
    moves: [[33, "Interview"], [12, "Rejected"]],
    lastActivityDaysAgo: 12,
    domains: [{ code: "Fullstack", members: 2, challenges: "Barcode scanning." }],
    rejectReason: "NoCapacity",
    decisionReason: "Engineering was fully staffed for the term. Invited them to reapply next cycle.",
    interviewRating: 3,
  },
  {
    id: "papp-haven-donations",
    title: "Donation drop-off tracker",
    orgId: "partner-upper-valley-haven",
    contactEmail: "jordan@uvhaven.example.org",
    summary: "Log donated goods at the drop-off door.",
    stage: "Rejected",
    source: "Form",
    createdDaysAgo: 140,
    moves: [[130, "Interview"], [118, "Rejected"]],
    lastActivityDaysAgo: 118,
    domains: [{ code: "Fullstack", members: 1, challenges: "Simple intake form." }],
    rejectReason: "Timing",
    decisionReason: "They needed it live before the holidays, which is earlier than a term can deliver.",
  },
  {
    id: "papp-hypertherm-intranet",
    title: "Intranet search",
    orgId: "partner-hypertherm",
    contactEmail: "riley.park@hypertherm.example.com",
    summary: "Search across internal wikis and file shares.",
    stage: "Rejected",
    source: "Manual",
    createdDaysAgo: 110,
    moves: [[104, "Rejected"]],
    lastActivityDaysAgo: 104,
    domains: [{ code: "Fullstack", members: 2, challenges: "Indexing internal systems." }],
    rejectReason: "Withdrawn",
    decisionReason: "Hypertherm IT decided to buy an off-the-shelf tool.",
  },
];

/** CRM fields for the three applications the base seed creates. */
const BASE_APP_FIELDS: Record<string, Prisma.PartnerApplicationUpdateInput> = {
  "papp-tuck-mentor": {
    interviewRating: 4,
    ambiguityRating: 4,
    evalRubric: { feasibility: 5, impact: 4, originality: 3, learning: 4, devChallenges: 4, designChallenges: 3, partnerTeam: 5, funding: 5, criteriaVersion: 1 },
    fundingType: "DALI_PTAEO",
    feeCents: 1_500_000,
    legalEntityName: "Trustees of Dartmouth College",
    legalEntityAddress: "100 Tuck Hall, Hanover, NH 03755",
    paymentSchedule: "Quarterly",
    sowState: "Shared",
  },
  "papp-hood-kiosk": {
    interviewRating: 4,
    ambiguityRating: 3,
    evalRubric: { feasibility: 3, impact: 5, originality: 4, learning: 4, devChallenges: 3, designChallenges: 5, partnerTeam: 4, funding: 4, notes: "Great design problem. Hardware install is the risk." },
    meetingRequestedAt: new Date(Date.now() - 31 * DAY),
  },
  "papp-thayer-sensors": { source: "Email" },
};

export async function seedPartnerCrmDemo(prisma: PrismaClient, opts: { adminId: string }) {
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * DAY);

  const domains = await prisma.domain.findMany({
    where: { code: { in: ["UIUX", "Fullstack", "PM"] } },
    select: { id: true, code: true },
  });
  const domainId = new Map(domains.map((d) => [d.code, d.id]));
  const term = await prisma.term.findUnique({ where: { code: "26S" }, select: { id: true } });

  const coreAssignees = await prisma.coreAssignment.findMany({
    distinct: ["userId"],
    select: { userId: true },
    take: 3,
  });
  const panel = [opts.adminId, ...coreAssignees.map((c) => c.userId).filter((id) => id !== opts.adminId)].slice(0, 3);

  // ── Orgs ──
  for (const [id, f] of Object.entries(ORG_FIELDS)) {
    await prisma.partnerOrg.update({ where: { id }, data: f });
  }
  for (const { id, ...o } of NEW_ORGS) {
    await prisma.partnerOrg.upsert({ where: { id }, update: o, create: { id, ...o } });
  }

  // ── Contacts and memberships ──
  const contactId = new Map<string, string>();
  for (const { email, name, orgId, role, endedDaysAgo, ...fields } of CONTACTS as (typeof CONTACTS[number] & {
    name?: string;
    orgId?: string;
    role?: string;
    endedDaysAgo?: number;
  })[]) {
    const contact = await prisma.partnerContact.upsert({
      where: { email },
      update: { ...fields, ...(name ? { name } : {}) },
      create: { email, name: name ?? email, ...fields },
      select: { id: true },
    });
    contactId.set(email, contact.id);
    if (orgId) {
      const endedAt = endedDaysAgo ? daysAgo(endedDaysAgo) : null;
      const membership = await prisma.partnerMembership.upsert({
        where: { contactId_orgId: { contactId: contact.id, orgId } },
        update: { role, endedAt },
        create: { contactId: contact.id, orgId, role, endedAt },
        select: { id: true },
      });
      const org = await prisma.partnerOrg.findUnique({ where: { id: orgId }, select: { primaryContactId: true } });
      if (!org?.primaryContactId && !endedAt) {
        await prisma.partnerOrg.update({ where: { id: orgId }, data: { primaryContactId: membership.id } });
      }
    }
  }
  // Greenline came in through Sam, so the org record shows who referred it.
  await prisma.partnerOrg.update({
    where: { id: "partner-greenline" },
    data: { referredByContactId: contactId.get("sam.okafor@example.com") },
  });

  // ── Base applications ──
  for (const [id, data] of Object.entries(BASE_APP_FIELDS)) {
    await prisma.partnerApplication.update({ where: { id }, data });
  }

  // ── New applications ──
  const positions = new Map<Stage, number>();
  for (const a of APPS) {
    const position = positions.get(a.stage) ?? 10;
    positions.set(a.stage, position + 1);
    const applicantContactId = contactId.get(a.contactEmail)!;
    const data = {
      title: a.title,
      summary: a.summary,
      partnerOrgId: a.orgId,
      applicantContactId,
      stage: a.stage,
      source: a.source,
      position,
      lastActivityAt: daysAgo(a.lastActivityDaysAgo),
      nextStep: a.nextStep ?? null,
      nextStepDueAt: a.nextStepDueInDays !== undefined ? daysAgo(-a.nextStepDueInDays) : null,
      holdUntil: a.holdUntilInDays !== undefined ? daysAgo(-a.holdUntilInDays) : null,
      rejectReason: a.rejectReason ?? null,
      decisionReason: a.decisionReason ?? null,
      interviewRating: a.interviewRating ?? null,
      ambiguityRating: a.ambiguityRating ?? null,
      evalRubric: a.evalRubric ? { ...a.evalRubric, criteriaVersion: 1 } : undefined,
      fundingType: a.fundingType ?? null,
      feeCents: a.feeCents ?? null,
      legalEntityName: a.legalEntityName ?? null,
      legalEntityAddress: a.legalEntityAddress ?? null,
      paymentSchedule: a.paymentSchedule ?? null,
      sowState: a.sowState ?? "Draft",
      meetingRequestedAt: a.meetingRequestedDaysAgo !== undefined ? daysAgo(a.meetingRequestedDaysAgo) : null,
      resultingProjectId: a.resultingProjectId ?? null,
    };
    await prisma.partnerApplication.upsert({
      where: { id: a.id },
      update: data,
      create: { id: a.id, createdAt: daysAgo(a.createdDaysAgo), ...data },
    });

    if (term) {
      await prisma.partnerApplicationTargetTerm.upsert({
        where: { applicationId_termId: { applicationId: a.id, termId: term.id } },
        update: {},
        create: { applicationId: a.id, termId: term.id },
      });
    }
    for (const d of a.domains) {
      const id = domainId.get(d.code);
      if (!id) continue;
      await prisma.partnerApplicationDomain.upsert({
        where: { applicationId_domainId: { applicationId: a.id, domainId: id } },
        update: { expectedMembers: d.members, expectedChallenges: d.challenges },
        create: { applicationId: a.id, domainId: id, expectedMembers: d.members, expectedChallenges: d.challenges },
      });
    }

    // History: Created, each stage move, then any notes.
    const base = { applicationId: a.id, orgId: a.orgId, contactId: applicantContactId };
    const activity: { id: string; type: "Created" | "StatusChanged" | "Note"; createdAt: Date; body?: string; metadata?: object }[] = [
      { id: `pact-${a.id}-created`, type: "Created", createdAt: daysAgo(a.createdDaysAgo), metadata: { source: a.source } },
    ];
    let from: Stage = "New";
    for (const [i, [when, to]] of a.moves.entries()) {
      activity.push({ id: `pact-${a.id}-move-${i}`, type: "StatusChanged", createdAt: daysAgo(when), metadata: { from, to } });
      from = to;
    }
    for (const [i, [when, body]] of (a.notes ?? []).entries()) {
      activity.push({ id: `pact-${a.id}-note-${i}`, type: "Note", createdAt: daysAgo(when), body });
    }
    for (const act of activity) {
      const row = { ...base, type: act.type, createdAt: act.createdAt, body: act.body ?? null, metadata: act.metadata, actorUserId: opts.adminId };
      await prisma.partnerActivity.upsert({ where: { id: act.id }, update: row, create: { id: act.id, ...row } });
    }
  }

  // ── Interview meetings with debriefs ──
  const meetings = [
    { id: "pmeet-greenline-1", applicationId: "papp-greenline-fleet", email: "alex@greenline.example.com", at: -2, notes: "Demo of the current ops spreadsheet. Fleet is 40 robots, growing to 120.", debrief: "Strong team, clear problem. Telemetry volume is the main unknown.", outcome: "Advance" as const },
    { id: "pmeet-geisel-1", applicationId: "papp-geisel-sleep", email: "dr.ng@geisel.example.edu", at: 30, notes: "Walked through the study protocol.", debrief: "Good project, but we can't start before IRB approval.", outcome: "Hold" as const },
    { id: "pmeet-hypertherm-1", applicationId: "papp-hypertherm-qc", email: "riley.park@hypertherm.example.com", at: 45, notes: "Shop floor tour and sample defect photos.", debrief: "Excellent fit. Funding confirmed on the call.", outcome: "Advance" as const },
    { id: "pmeet-thayer-inv-1", applicationId: "papp-thayer-inventory", email: "partner-thayer@seed.dali", at: 20, notes: "Reviewed current tool checkout process.", debrief: "Fine project, no engineering capacity this term.", outcome: "Reject" as const },
  ];
  for (const m of meetings) {
    const row = {
      applicationId: m.applicationId,
      contactId: contactId.get(m.email),
      scheduledAt: daysAgo(m.at),
      attendeeUserIds: panel,
      notes: m.notes,
      // A meeting in the future has no debrief yet.
      debrief: m.at > 0 ? m.debrief : null,
      outcome: m.at > 0 ? m.outcome : null,
    };
    await prisma.partnerMeeting.upsert({ where: { id: m.id }, update: row, create: { id: m.id, ...row } });
  }

  // ── Meeting requests in every state ──
  const requests = [
    { id: "pmr-greenline-1", applicationId: "papp-greenline-fleet", email: "alex@greenline.example.com", at: -5, status: "Pending" as const, note: "Could Morgan join for the technical half?" },
    { id: "pmr-haven-1", applicationId: "papp-haven-volunteers", email: "jordan@uvhaven.example.org", at: -3, status: "Pending" as const, note: "Any weekday after 2pm works." },
    { id: "pmr-hypertherm-1", applicationId: "papp-hypertherm-qc", email: "riley.park@hypertherm.example.com", at: 46, status: "Accepted" as const, responseNote: "See you at the plant." },
    { id: "pmr-alumni-1", applicationId: "papp-alumni-trailhead", email: "sam.okafor@example.com", at: 10, status: "Declined" as const, responseNote: "Panel is booked that week. Suggested two other times." },
    { id: "pmr-geisel-1", applicationId: "papp-geisel-sleep", email: "dr.ng@geisel.example.edu", at: 35, status: "Expired" as const },
  ];
  for (const r of requests) {
    const responded = r.status === "Accepted" || r.status === "Declined";
    const row = {
      applicationId: r.applicationId,
      contactId: contactId.get(r.email)!,
      startTime: daysAgo(r.at),
      durationMinutes: 30,
      participantUserIds: panel,
      note: r.note ?? null,
      status: r.status,
      respondedByUserId: responded ? opts.adminId : null,
      respondedAt: responded ? daysAgo(r.at + 2) : null,
      responseNote: r.responseNote ?? null,
    };
    await prisma.partnerMeetingRequest.upsert({ where: { id: r.id }, update: row, create: { id: r.id, ...row } });
  }

  // ── Invoices in every state ──
  const invoices = [
    { id: "pinv-hypertherm-1", orgId: "partner-hypertherm", applicationId: "papp-hypertherm-qc", amountCents: 1_250_000, status: "Paid" as const, issued: 30, due: 0, paid: 12, reference: "INV-1002", note: "Kickoff payment" },
    { id: "pinv-hypertherm-2", orgId: "partner-hypertherm", applicationId: "papp-hypertherm-qc", amountCents: 1_250_000, status: "Draft" as const, note: "Final demo payment" },
    { id: "pinv-rocket-1", orgId: "partner-prof-rocket", applicationId: "papp-rocket-telemetry-renewal", amountCents: 1_200_000, status: "Issued" as const, issued: 40, due: 10, reference: "INV-1003", note: "Overdue: grant office is processing it." },
    { id: "pinv-tuck-void", orgId: "partner-tuck-school", applicationId: "papp-tuck-mentor", amountCents: 750_000, status: "Void" as const, issued: 20, reference: "INV-0999", note: "Issued with the wrong chart string. Replaced by INV-1001." },
  ];
  for (const inv of invoices) {
    const row = {
      orgId: inv.orgId,
      applicationId: inv.applicationId,
      amountCents: inv.amountCents,
      status: inv.status,
      issuedAt: inv.issued !== undefined ? daysAgo(inv.issued) : null,
      dueAt: inv.due !== undefined ? daysAgo(inv.due) : null,
      paidAt: inv.paid !== undefined ? daysAgo(inv.paid) : null,
      reference: inv.reference ?? null,
      note: inv.note,
    };
    await prisma.partnerInvoice.upsert({ where: { id: inv.id }, update: row, create: { id: inv.id, ...row } });
  }

  // ── Partnerships: start dates, and one that ended with its survey sent ──
  const links = [
    { projectId: "project-tuck-alumni", orgId: "partner-tuck-school", started: 300 },
    { projectId: "project-hood-vr", orgId: "partner-hood-museum", started: 200 },
    { projectId: "project-rocket-arm", orgId: "partner-prof-rocket", started: 420 },
    { projectId: "project-archived-2023", orgId: "partner-dali-internal", started: 700, ended: 380, surveySent: 375 },
  ];
  for (const l of links) {
    await prisma.projectPartner.update({
      where: { projectId_partnerOrgId: { projectId: l.projectId, partnerOrgId: l.orgId } },
      data: {
        startedAt: daysAgo(l.started),
        endedAt: l.ended !== undefined ? daysAgo(l.ended) : null,
        surveySentAt: l.surveySent !== undefined ? daysAgo(l.surveySent) : null,
      },
    });
  }

  await prisma.partnerCrmSettings.upsert({
    where: { id: "default" },
    update: { interviewPanelUserIds: panel, staleDays: 14 },
    create: { id: "default", interviewPanelUserIds: panel, staleDays: 14 },
  });

  return { orgs: NEW_ORGS.length, contacts: CONTACTS.length, applications: APPS.length };
}
