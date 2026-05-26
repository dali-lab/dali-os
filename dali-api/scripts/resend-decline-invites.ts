// Backfill the "you're the new interviewer" invite for interviews where an
// interviewer declined and the auto-reassign succeeded but no email was
// sent. The decline path was missing the call to sendReassignmentEmails
// before PR #702 — this script repairs the affected cases.
//
// For each interview ID, finds the post-decline Active assignment (the
// replacement) and emails just that one interviewer (invite + ICS REQUEST).
// Does NOT email the applicant, co-interviewers, or the original decliner.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/resend-decline-invites.ts [--dry-run] <interviewId> [<interviewId> ...]
//
// Tip: run with --dry-run first to see who would receive each email.

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { sendInviteEmailToNewInterviewer } from "../app/hiring/lib/interview-emails.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const interviewIds = args.filter((a) => !a.startsWith("--"));

if (interviewIds.length === 0) {
  console.error(
    "Usage: DATABASE_URL=... npx tsx scripts/resend-decline-invites.ts [--dry-run] <interviewId> [...]",
  );
  process.exit(1);
}

for (const interviewId of interviewIds) {
  const declined = await prisma.interviewAssignment.findFirst({
    where: { interviewId, status: "Declined" },
    orderBy: { createdAt: "desc" },
  });
  if (!declined) {
    console.log(`[${interviewId}] no Declined assignment — skip`);
    continue;
  }

  const active = await prisma.interviewAssignment.findFirst({
    where: {
      interviewId,
      status: "Active",
      role: declined.role,
      createdAt: { gt: declined.createdAt },
    },
    include: {
      cycleInterviewer: {
        include: { user: { select: { firstName: true, daliEmail: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!active) {
    console.log(`[${interviewId}] no replacement Active assignment for role=${declined.role} — skip`);
    continue;
  }

  const user = active.cycleInterviewer.user;
  const name = user?.firstName ?? "?";
  const email = user?.daliEmail ?? "?";
  console.log(
    `[${interviewId}] ${dryRun ? "WOULD send" : "sending"} invite to ${name} <${email}> (cycleInterviewerId=${active.cycleInterviewerId}, role=${active.role})`,
  );

  if (!dryRun) {
    const result = await sendInviteEmailToNewInterviewer(interviewId, active.cycleInterviewerId);
    console.log(`[${interviewId}] result: ${JSON.stringify(result)}`);
  }
}

await prisma.$disconnect();
