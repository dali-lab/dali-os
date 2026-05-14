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
  // Legacy `name` values that should be matched and merged into this row
  // when running against a database that pre-dates Phase 1. The first run of
  // this seed against staging created v0-reference rows alongside the legacy
  // ones (because the upsert keyed on code, which the legacy rows didn't
  // have). This list lets the heal step below find the live legacy row by
  // name and assign it the canonical code instead — preserving all the
  // ChallengeVersion / DomainApplicationCycle / DomainLeadAssignment /
  // CycleReviewer / CycleInterviewer / DelibsSession references already
  // pointing at it.
  legacyNames?: string[];
};

const DOMAINS: DomainSeed[] = [
  { code: "Fullstack", displayName: "Fullstack Dev", isInternProgram: false, legacyNames: ["Fullstack Development"] },
  { code: "UIUX", displayName: "UI/UX Design", isInternProgram: false, legacyNames: ["UI/UX Design"] },
  { code: "ARVR", displayName: "AR/VR Dev", isInternProgram: false, legacyNames: ["AR/VR Development"] },
  { code: "Data", displayName: "Data Dev", isInternProgram: false, legacyNames: ["Data Development"] },
  { code: "Engineering", displayName: "Engineering", isInternProgram: false, legacyNames: ["Engineering"] },
  { code: "ThreeDModeling", displayName: "3D Modeling", isInternProgram: false, legacyNames: ["3D Modeling"] },
  { code: "Animation", displayName: "Animation", isInternProgram: false, legacyNames: ["Animation"] },
  { code: "Graphics", displayName: "Graphics", isInternProgram: false, legacyNames: ["Graphics"] },
  { code: "Writing", displayName: "Writing", isInternProgram: false, legacyNames: ["Writing"] },
  { code: "Videography", displayName: "Videography", isInternProgram: false, legacyNames: ["Videography"] },
  { code: "Photography", displayName: "Photography", isInternProgram: false, legacyNames: ["Photography"] },
  { code: "Production", displayName: "Production", isInternProgram: false },
  { code: "PM", displayName: "Product Management", isInternProgram: false, legacyNames: ["Product Management"] },
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
  let healed = 0;
  let mergedDuplicates = 0;

  for (const d of DOMAINS) {
    // ── Heal step ──────────────────────────────────────────────────────────
    // If a legacy row (pre-Phase-1) exists for one of this domain's
    // `legacyNames` with no `code` yet, assign it the canonical code +
    // displayName. This preserves all FK references attached to the legacy
    // row (ChallengeVersion, DomainApplicationCycle, etc.).
    let healedRow: { id: string } | null = null;
    if (d.legacyNames && d.legacyNames.length > 0) {
      // Prisma 7's generated `StringFilter` for the nullable `code` column
      // doesn't include `null` in the type union, even though the runtime
      // accepts it. Raw SQL bypasses the typing issue and is clearer here.
      const [legacy] = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Domain"
        WHERE code IS NULL AND name = ANY(${d.legacyNames}::text[])
        LIMIT 1
      `;
      if (legacy) {
        // If a prior run of this seed already created a duplicate by code,
        // delete it first to free the unique constraint. The duplicate has
        // no FK references (it was just created and never used).
        const duplicate = await prisma.domain.findUnique({
          where: { code: d.code },
        });
        if (duplicate && duplicate.id !== legacy.id) {
          await prisma.domain.delete({ where: { id: duplicate.id } });
          mergedDuplicates++;
        }
        healedRow = await prisma.domain.update({
          where: { id: legacy.id },
          data: {
            code: d.code,
            displayName: d.displayName,
            isInternProgram: d.isInternProgram,
            active: true,
          },
        });
        healed++;
      }
    }

    if (healedRow) continue;

    // ── Upsert step ────────────────────────────────────────────────────────
    // Either no legacy row to heal, or it was already healed on a prior run.
    // Regular upsert by code; create the row if it doesn't exist yet.
    await prisma.domain.upsert({
      where: { code: d.code },
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
  console.log(
    `✓ Seeded ${DOMAINS.length} domains (healed ${healed} legacy rows, ` +
    `merged ${mergedDuplicates} duplicate v0-reference rows).`,
  );
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
