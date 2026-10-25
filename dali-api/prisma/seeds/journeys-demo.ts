/**
 * Sample onboarding journeys (/journeys): four per domain for Fullstack, UI/UX
 * and Product, published and owned by the given user, with lessons, slides,
 * labs and quizzes. Domains that don't exist are skipped.
 *
 * Idempotent: rows are upserted on stable ids. Runs as part of `prisma db
 * seed`, or alone against an existing database:
 *
 *   npm run db:seed:journeys-demo
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Prisma } from "../../app/generated/prisma/client.js";
import { getServerEditor } from "../../app/collab/blocknote-server.js";
import type { JourneyContent, RichDoc, Slide } from "../../app/journeys/lib/types.js";
import { apisDataJourney, webFoundationsJourney } from "./journeys-demo/development.js";
import { designFoundationsJourney, userResearchJourney } from "./journeys-demo/design.js";
import { partnerManagementJourney, pmEssentialsJourney } from "./journeys-demo/product.js";
import {
  accessibleWebJourney,
  demoDayJourney,
  designSystemsJourney,
  prototypingJourney,
  testingReviewJourney,
  ticketsJourney,
} from "./journeys-demo/more.js";
import { affinityMap, labInventoryTicket, trailFinderCritique } from "./journeys-demo/studio-labs.js";
import type { SeedJourney, SeedStudioLab } from "./journeys-demo/types.js";
import type { CanvasItem, StudioLab } from "../../app/journeys/lib/studio-types.js";

const BY_DOMAIN: Record<string, SeedJourney[]> = {
  Fullstack: [webFoundationsJourney, apisDataJourney, testingReviewJourney, accessibleWebJourney],
  UIUX: [designFoundationsJourney, userResearchJourney, prototypingJourney, designSystemsJourney],
  PM: [pmEssentialsJourney, partnerManagementJourney, ticketsJourney, demoDayJourney],
};

// Whiteboard and document labs, by journey then module.
const STUDIO_LABS: Record<string, Record<string, SeedStudioLab>> = {
  "design-foundations": { "partner-critique": trailFinderCritique },
  "user-research": { synthesis: affinityMap },
  "pm-essentials": { "writing-tickets": labInventoryTicket },
};

// The owner's own progress, so the list shows every state: in progress,
// completed and not started.
const SAMPLE_PROGRESS: Record<string, string[]> = {
  "web-foundations": ["dev-welcome#lab", "dev-welcome"],
  "writing-tickets": ["wt-anatomy", "wt-sizing#quiz", "wt-sizing", "wt-grooming"],
};

async function toDoc(html: string | undefined): Promise<RichDoc> {
  if (!html?.trim()) return [];
  return (await getServerEditor().tryParseHTMLToBlocks(html)) as RichDoc;
}

async function toStudio(lab: SeedStudioLab): Promise<StudioLab> {
  const { document, ...rest } = lab;
  return document ? { ...rest, document: { template: await toDoc(document.template) } } : rest;
}

async function toContent({ id, ...journey }: SeedJourney): Promise<JourneyContent> {
  const modules = [];
  for (const seedModule of journey.modules) {
    const studio = STUDIO_LABS[id]?.[seedModule.id] ?? seedModule.studio;
    const { studio: _studio, ...m } = seedModule;
    const pages = [];
    for (const p of m.pages) pages.push({ ...p, content: await toDoc(p.content) });
    const slides: Slide[] = [];
    for (const s of m.slides ?? []) slides.push({ ...s, body: s.body === undefined ? undefined : await toDoc(s.body) });
    modules.push({ ...m, pages, slides: m.slides ? slides : undefined, ...(studio ? { studio: await toStudio(studio) } : {}) });
  }
  return { ...journey, modules };
}

const fromStarter = (items: CanvasItem[] = []) => items.map((i) => ({ ...i, fromStarter: true }));

// Work a learner sent for review, so Reviews has something waiting.
async function sampleSubmissions(learnerId: string) {
  return [
    {
      journeyId: "demo-journey-design-foundations",
      moduleId: "partner-critique",
      selfChecks: { "tf-c3": true },
      work: {
        items: [
          ...fromStarter(trailFinderCritique.canvas?.items),
          { id: "s-p1", type: "pin", x: 166, y: 12, text: "Contrast: the title is pale gray on white and nearly invisible." },
          { id: "s-p2", type: "pin", x: 300, y: 64, text: "Labels: search only has placeholder text, which disappears when you type." },
          { id: "s-p3", type: "pin", x: 250, y: 180, text: "Contrast: \"Explore now\" sits on the brightest part of the photo." },
          { id: "s-p4", type: "pin", x: 166, y: 530, text: "Consistency: three buttons, three styles. Which one is primary?" },
          { id: "s-p5", type: "pin", x: 40, y: 600, text: "Tap targets: six icons, no labels, too close together." },
          { id: "s-s1", type: "sticky", x: 420, y: 220, width: 200, height: 180, color: "yellow", text: "Make the title navy at 20px so it passes 4.5:1 contrast." },
          { id: "s-s2", type: "sticky", x: 640, y: 220, width: 200, height: 180, color: "yellow", text: "Add a dark scrim behind \"Explore now\"." },
          { id: "s-s3", type: "sticky", x: 420, y: 420, width: 200, height: 180, color: "yellow", text: "One filled primary button, others as text links." },
        ],
      },
    },
    {
      journeyId: "demo-journey-pm-essentials",
      moduleId: "writing-tickets",
      selfChecks: { "tk-c4": true },
      work: {
        doc: await toDoc(
          "<h3>Title</h3><p>Show live availability for each item in the equipment list</p><h3>Why</h3><p>Students walk across campus to find equipment is already in use. Seeing availability before they leave saves time and is the first step toward booking.</p><h3>Done when</h3><ul><li><p>Each item in the list shows Available or In use</p></li><li><p>Status updates within 1 minute of a sign-out</p></li><li><p>Students can filter to only available items</p></li></ul><h3>Out of scope</h3><p>Reserving items and return reminders come in later tickets.</p><h3>Design</h3><p>Figma, Lab Inventory, Equipment list</p>",
        ),
      },
    },
  ].map((s) => ({ ...s, userId: learnerId }));
}

export async function seedJourneysDemo(prisma: PrismaClient, { ownerId }: { ownerId: string }) {
  for (const [code, journeys] of Object.entries(BY_DOMAIN)) {
    const domain = await prisma.domain.findUnique({ where: { code }, select: { id: true } });
    if (!domain) continue;
    for (const seed of journeys) {
      const id = `demo-journey-${seed.id}`;
      // Through JSON so the undefined fields BlockNote leaves behind drop out; Prisma rejects them.
      const content = JSON.parse(JSON.stringify(await toContent(seed))) as Prisma.InputJsonValue;
      await prisma.onboardingJourney.upsert({
        where: { id },
        create: { id, domainId: domain.id, draft: content, published: content, publishedAt: new Date(), createdById: ownerId },
        update: { domainId: domain.id, draft: content, published: content },
      });
      const progress = SAMPLE_PROGRESS[seed.id];
      if (progress) {
        await prisma.onboardingJourneyProgress.upsert({
          where: { journeyId_userId: { journeyId: id, userId: ownerId } },
          create: { journeyId: id, userId: ownerId, completed: progress },
          update: { completed: progress },
        });
      }
      await prisma.onboardingJourneyCollaborator.upsert({
        where: { journeyId_userId: { journeyId: id, userId: ownerId } },
        create: { journeyId: id, userId: ownerId, role: "Owner" },
        update: {},
      });
    }
  }
  await seedSubmissions(prisma, ownerId);
}

// Standalone run against an existing database (no reset).
async function seedSubmissions(prisma: PrismaClient, ownerId: string) {
  const learner = await prisma.user.findFirst({
    where: { id: { not: ownerId }, daliMember: { isNot: null }, membershipStatus: "Active" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!learner) return;
  for (const s of await sampleSubmissions(learner.id)) {
    const exists = await prisma.onboardingJourney.findUnique({ where: { id: s.journeyId }, select: { id: true } });
    if (!exists) continue;
    const data = { work: JSON.parse(JSON.stringify(s.work)), selfChecks: s.selfChecks, status: "Submitted" as const, submittedAt: new Date() };
    await prisma.onboardingLabSubmission.upsert({
      where: { journeyId_moduleId_userId: { journeyId: s.journeyId, moduleId: s.moduleId, userId: s.userId } },
      create: { journeyId: s.journeyId, moduleId: s.moduleId, userId: s.userId, ...data },
      update: { ...data, mentorChecks: {}, mentorNote: null, reviewerId: null, reviewedAt: null },
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  (async () => {
    const owner =
      (await prisma.user.findFirst({ where: { adminMembership: { isNot: null } }, select: { id: true } })) ??
      (await prisma.user.findFirstOrThrow({ select: { id: true } }));
    await seedJourneysDemo(prisma, { ownerId: owner.id });
    console.log("✓ Seeded the sample onboarding journeys.");
  })()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
