// Usage: npx tsx scripts/applicant-timeline.ts "First Last"
// Prints a chronological timeline of all application-lifecycle events for the
// named applicant: status updates, reviews, interviews, decisions.

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npx tsx scripts/applicant-timeline.ts "First Last" | <userId> | <email>');
  process.exit(1);
}

const looksLikeId = /^c[a-z0-9]{20,}$/i.test(arg);
const looksLikeEmail = arg.includes("@");

const where = looksLikeId
  ? { id: arg }
  : looksLikeEmail
    ? { OR: [{ dartmouthEmail: arg }, { daliEmail: arg }] }
    : (() => {
        const [firstName, ...rest] = arg.trim().split(/\s+/);
        const lastName = rest.join(" ");
        return {
          firstName: { equals: firstName, mode: "insensitive" as const },
          lastName: { equals: lastName, mode: "insensitive" as const },
        };
      })();

const users = await prisma.user.findMany({
  where,
  select: {
    id: true,
    firstName: true,
    lastName: true,
    dartmouthEmail: true,
    daliEmail: true,
    netId: true,
  },
});

if (users.length === 0) {
  console.log(`No user found matching "${firstName} ${lastName}".`);
  await prisma.$disconnect();
  process.exit(0);
}
if (users.length > 1) {
  console.log(`Multiple users matched — disambiguate by email:`);
  for (const u of users) {
    console.log(`  ${u.id}  ${u.firstName} ${u.lastName}  ${u.daliEmail ?? u.dartmouthEmail ?? u.netId ?? "?"}`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

const user = users[0];
const email = user.daliEmail ?? user.dartmouthEmail ?? user.netId ?? "?";
console.log(`\n=== ${user.firstName} ${user.lastName} (${email}) ===`);

const apps = await prisma.application.findMany({
  where: { userId: user.id },
  include: {
    applicationCycle: { select: { name: true } },
    statusUpdates: { include: { user: { select: { firstName: true, lastName: true } } } },
    domainApplications: {
      include: {
        domain: { select: { name: true } },
        reviews: {
          include: {
            cycleReviewer: { include: { daliMember: { include: { user: { select: { firstName: true, lastName: true } } } } } },
            submittedBy: { include: { user: { select: { firstName: true, lastName: true } } } },
          },
        },
        interviews: true,
        decisions: {
          include: { madeBy: { include: { user: { select: { firstName: true, lastName: true } } } } },
        },
      },
    },
  },
  orderBy: { createdAt: "asc" },
});

if (apps.length === 0) {
  console.log("No applications on record.\n");
  await prisma.$disconnect();
  process.exit(0);
}

type Event = { at: Date; line: string };
const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + "Z";
const who = (u?: { firstName: string; lastName: string } | null) =>
  u ? `${u.firstName} ${u.lastName}` : "?";

for (const app of apps) {
  console.log(`\n--- Application: ${app.applicationCycle.name} (id ${app.id}) ---`);
  console.log(`Created: ${fmt(app.createdAt)}   Updated: ${fmt(app.updatedAt)}`);
  console.log(`Domains applied: ${app.domainApplications.map(da => `${da.domain?.name ?? "?"}${da.selected ? "" : " (deselected)"}`).join(", ") || "(none)"}`);

  const events: Event[] = [];
  events.push({ at: app.createdAt, line: `APP CREATED` });

  for (const s of app.statusUpdates) {
    events.push({ at: s.createdAt, line: `STATUS → ${s.newStatus}  by ${who(s.user)}` });
  }

  for (const da of app.domainApplications) {
    const dom = da.domain?.name ?? "?";
    events.push({ at: da.createdAt, line: `[${dom}] domain application created${da.selected ? "" : " (later deselected)"}` });

    for (const r of da.reviews) {
      const reviewer = who(r.cycleReviewer.daliMember.user);
      events.push({ at: r.createdAt, line: `[${dom}] REVIEW started by ${reviewer}` });
      if (r.submittedAt) {
        const submitter = who(r.submittedBy?.user ?? null);
        const rec = r.overallRecommendation ?? "(no rec)";
        events.push({ at: r.submittedAt, line: `[${dom}] REVIEW submitted by ${submitter} — ${rec}` });
      }
    }

    for (const iv of da.interviews) {
      events.push({ at: iv.createdAt, line: `[${dom}] INTERVIEW scheduled for ${fmt(iv.startTime)} (${iv.location}) — status ${iv.status}` });
      if (iv.status !== "Scheduled") {
        events.push({ at: iv.updatedAt, line: `[${dom}] INTERVIEW status → ${iv.status}` });
      }
    }

    for (const d of da.decisions) {
      const maker = who(d.madeBy.user);
      const wl = d.waitlistRank != null ? ` (rank ${d.waitlistRank})` : "";
      events.push({ at: d.createdAt, line: `[${dom}] DECISION ${d.type} — ${d.stage}${wl}  by ${maker}` });
    }
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  console.log("");
  for (const e of events) console.log(`  ${fmt(e.at)}  ${e.line}`);
}

console.log("");
await prisma.$disconnect();
