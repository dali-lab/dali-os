// Find ApplicationReview rows tied to DomainApplications the applicant
// deselected (selected = false). These are "phantom" reviews — the applicant
// never submitted for that domain, but a reviewer was assigned to it (likely
// via the auto-assign endpoint, which used to skip the `selected: true`
// filter).
//
// Read-only by default. Pass `--delete` to remove phantom reviews that have
// no review data entered. Phantoms with any data (scores, feedback,
// recommendation, or submittedAt) are always reported but never auto-deleted —
// decide manually.
//
// Run: DATABASE_URL=... npx tsx scripts/find-phantom-reviews.ts [--delete]

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const shouldDelete = process.argv.includes("--delete");

const phantoms = await prisma.applicationReview.findMany({
  where: { domainApplication: { selected: false } },
  include: {
    domainApplication: {
      include: {
        application: {
          include: {
            user: { select: { firstName: true, lastName: true, dartmouthEmail: true, daliEmail: true, netId: true } },
            applicationCycle: { select: { name: true } },
          },
        },
        challengeVersion: { include: { domain: { select: { name: true } } } },
      },
    },
    cycleReviewer: {
      include: { daliMember: { select: { firstName: true, lastName: true, daliEmail: true } } },
    },
  },
  orderBy: { createdAt: "asc" },
});

console.log(`Found ${phantoms.length} phantom review(s) (DomainApplication.selected = false).\n`);

const safeToDelete: string[] = [];
const hasData: typeof phantoms = [];

for (const r of phantoms) {
  const u = r.domainApplication.application.user;
  const applicant = `${u.firstName} ${u.lastName} <${u.daliEmail ?? u.dartmouthEmail ?? u.netId ?? "?"}>`;
  const domain = r.domainApplication.challengeVersion.domain?.name ?? "?";
  const cycle = r.domainApplication.application.applicationCycle.name;
  const m = r.cycleReviewer.daliMember;
  const reviewer = `${m.firstName} ${m.lastName} <${m.daliEmail}>`;

  const scores = r.scores as Record<string, unknown>;
  const hasScores = scores && Object.keys(scores).length > 0;
  const hasFeedback = r.feedback.trim().length > 0;
  const hasRationale = r.rejectionRationale.trim().length > 0;
  const hasRec = r.overallRecommendation !== null;
  const annotations = r.annotations as unknown[];
  const hasAnnotations = Array.isArray(annotations) && annotations.length > 0;
  const hasAnyData = hasScores || hasFeedback || hasRationale || hasRec || hasAnnotations || r.submittedAt !== null;

  console.log(`reviewId=${r.id}`);
  console.log(`  cycle:    ${cycle}`);
  console.log(`  domain:   ${domain}`);
  console.log(`  applicant:${applicant}`);
  console.log(`  reviewer: ${reviewer}`);
  console.log(`  daId:     ${r.domainApplication.id}`);
  console.log(`  data:     scores=${hasScores} feedback=${hasFeedback} rationale=${hasRationale} rec=${hasRec} annotations=${hasAnnotations} submitted=${r.submittedAt !== null}`);
  console.log("");

  if (hasAnyData) {
    hasData.push(r);
  } else {
    safeToDelete.push(r.id);
  }
}

console.log(`Summary: ${safeToDelete.length} safe to delete (no data), ${hasData.length} have data and need manual review.`);

if (shouldDelete) {
  if (hasData.length > 0) {
    console.log(`\nWARNING: ${hasData.length} phantom review(s) contain data and will NOT be deleted automatically:`);
    for (const r of hasData) console.log(`  - ${r.id}`);
  }
  if (safeToDelete.length > 0) {
    const result = await prisma.applicationReview.deleteMany({
      where: { id: { in: safeToDelete } },
    });
    console.log(`\nDeleted ${result.count} phantom review(s) with no data.`);
  } else {
    console.log("\nNothing to delete.");
  }
} else {
  console.log("\n(read-only run — pass --delete to remove the empty phantom reviews)");
}

await prisma.$disconnect();
