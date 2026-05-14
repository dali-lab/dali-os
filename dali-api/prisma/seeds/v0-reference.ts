/**
 * v0 reference-data seeder. Run AFTER `npx prisma migrate deploy` has applied
 * the `20260514040346_v0_phase1_additive` migration. Idempotent — re-runs are
 * safe (uses upserts and skips rows already present).
 *
 *   npm run db:seed:v0-reference        (production / staging / dev)
 *
 * What this seeds:
 *   - 17 Domain rows (with code, displayName, isInternProgram). Backfills
 *     code/displayName on existing Domain rows where missing.
 *   - Term rows: 26W..28F (an 8-quarter window).
 *   - 7 PageTemplate rows (Empty, Project Brief, Sprint Retro, Sprint Goals,
 *     Meeting Notes, Decision Log, Onboarding Doc) — empty contentDoc; the
 *     Page Tree UX track replaces the contentDoc bodies when it ships.
 *   - 1 MentorNoteTemplate row (default) — empty contentDoc; mentorship track
 *     replaces.
 *
 * NOT seeded (out of scope for v0 reference data):
 *   - JobCodeLookup — needs real Dartmouth payroll mapping; the Admin Console
 *     payroll-codes UI (admin CRUD track) is the entry point.
 *   - Domain-specific OAuthClient rows — MCP foundation track seeds these.
 *   - StaffingCycle / Project / EducationOffering — operational data created
 *     via UI by Core members.
 */

import { PrismaClient } from "../../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

// Lives outside prisma/data/ because prisma/data/ is gitignored (PII).

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type DomainSeed = {
  code: string;
  displayName: string;
  isInternProgram: boolean;
};

const DOMAINS: DomainSeed[] = [
  { code: "Fullstack", displayName: "Fullstack Dev", isInternProgram: false },
  { code: "UIUX", displayName: "UI/UX Design", isInternProgram: false },
  { code: "ARVR", displayName: "AR/VR Dev", isInternProgram: false },
  { code: "Data", displayName: "Data Dev", isInternProgram: false },
  { code: "Engineering", displayName: "Engineering", isInternProgram: false },
  { code: "ThreeDModeling", displayName: "3D Modeling", isInternProgram: false },
  { code: "Animation", displayName: "Animation", isInternProgram: false },
  { code: "Graphics", displayName: "Graphics", isInternProgram: false },
  { code: "Writing", displayName: "Writing", isInternProgram: false },
  { code: "Videography", displayName: "Videography", isInternProgram: false },
  { code: "Photography", displayName: "Photography", isInternProgram: false },
  { code: "Production", displayName: "Production", isInternProgram: false },
  { code: "PM", displayName: "Product Management", isInternProgram: false },
  { code: "DigitalArts", displayName: "Digital Arts Design", isInternProgram: false },
  { code: "ERAS", displayName: "ERAS Intern", isInternProgram: true },
  { code: "EEJUST", displayName: "EE Just Intern", isInternProgram: true },
  { code: "WISP", displayName: "WISP Intern", isInternProgram: true },
];

type Season = "W" | "S" | "X" | "F";
const SEASONS: { code: Season; sortIndex: 1 | 2 | 3 | 4 }[] = [
  { code: "W", sortIndex: 1 },
  { code: "S", sortIndex: 2 },
  { code: "X", sortIndex: 3 },
  { code: "F", sortIndex: 4 },
];

// Approximate Dartmouth quarter windows. Dates are illustrative; Admin
// Console > Terms can edit any of these post-seed if real boundaries shift.
function quarterDates(year: number, season: Season): { start: Date; end: Date } {
  switch (season) {
    case "W": return { start: new Date(`${year}-01-04`), end: new Date(`${year}-03-13`) };
    case "S": return { start: new Date(`${year}-03-28`), end: new Date(`${year}-06-05`) };
    case "X": return { start: new Date(`${year}-06-22`), end: new Date(`${year}-08-29`) };
    case "F": return { start: new Date(`${year}-09-12`), end: new Date(`${year}-11-23`) };
  }
}

async function seedDomains() {
  for (const d of DOMAINS) {
    await prisma.domain.upsert({
      where: { code: d.code },
      // If the row already exists, update only the new Phase 1 fields.
      // Legacy `name` is left alone (Phase 2 drops it).
      update: {
        displayName: d.displayName,
        isInternProgram: d.isInternProgram,
        active: true,
      },
      create: {
        name: d.displayName,
        code: d.code,
        displayName: d.displayName,
        isInternProgram: d.isInternProgram,
        active: true,
      },
    });
  }
  console.log(`✓ Seeded ${DOMAINS.length} domains.`);
}

async function seedTerms() {
  // 26W .. 28F (12 quarters).
  let count = 0;
  for (const year of [2026, 2027, 2028]) {
    for (const s of SEASONS) {
      const code = `${year % 100}${s.code}`;
      const { start, end } = quarterDates(year, s.code);
      const sortKey = year * 10 + s.sortIndex;
      await prisma.term.upsert({
        where: { code },
        update: { sortKey, startDate: start, endDate: end, season: s.code, year },
        create: { code, year, season: s.code, sortKey, startDate: start, endDate: end },
      });
      count++;
    }
  }
  console.log(`✓ Seeded ${count} terms.`);
}

async function seedPageTemplates() {
  // Stub collab doc id per template. The Page Tree UX track replaces these
  // with real CollabDocument rows whose bodies encode the template content.
  const TEMPLATES = [
    { name: "Empty", iconEmoji: "📄", isDefault: true },
    { name: "Project Brief", iconEmoji: "📋", isDefault: false },
    { name: "Sprint Retro", iconEmoji: "🔁", isDefault: false },
    { name: "Sprint Goals", iconEmoji: "🎯", isDefault: false },
    { name: "Meeting Notes", iconEmoji: "📝", isDefault: false },
    { name: "Decision Log", iconEmoji: "✅", isDefault: false },
    { name: "Onboarding Doc", iconEmoji: "🚀", isDefault: false },
  ] as const;

  for (const t of TEMPLATES) {
    const existing = await prisma.pageTemplate.findFirst({ where: { name: t.name } });
    if (existing) continue;
    await prisma.pageTemplate.create({
      data: {
        name: t.name,
        contentDocId: `page-template:${t.name.toLowerCase().replace(/\s+/g, "-")}`,
        iconEmoji: t.iconEmoji,
        isDefault: t.isDefault,
        workspaceTypes: [],
      },
    });
  }
  console.log(`✓ Seeded ${TEMPLATES.length} page templates (existing rows untouched).`);
}

async function seedMentorNoteTemplate() {
  const existing = await prisma.mentorNoteTemplate.findFirst({ where: { isDefault: true } });
  if (existing) {
    console.log(`✓ Mentor-note default template already present (id=${existing.id}).`);
    return;
  }
  await prisma.mentorNoteTemplate.create({
    data: {
      name: "Weekly Mentor Note (default)",
      contentDocId: "mentor-note-template:default",
      isDefault: true,
    },
  });
  console.log(`✓ Seeded default mentor-note template.`);
}

async function main() {
  console.log("Running v0 reference-data seed against", process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(unknown DB)");
  await seedDomains();
  await seedTerms();
  await seedPageTemplates();
  await seedMentorNoteTemplate();
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
