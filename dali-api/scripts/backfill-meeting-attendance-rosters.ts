/**
 * Backfill MeetingAttendance rows for existing meetings that have guests but no
 * roster. createScheduledMeeting now fans out a row per participant (+organizer)
 * for any meeting with guests, so the wallet scanner and Attendance tab work; a
 * meeting scheduled before that change with no meeting note and Roster mode got
 * zero rows, so its scanner rejected every pass as "User was not invited" and it
 * never appeared on the Attendance tab. This is the one-off pass to repair them.
 *
 * Scoped to non-cancelled meetings that have participants but zero attendance
 * rows. Idempotent — a meeting that already has a roster is skipped, so re-runs
 * are safe. Creates rows for the participant list plus the organizer.
 *
 * Dry-run by default.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-meeting-attendance-rosters.ts           # dry run
 *   npx tsx --env-file .env scripts/backfill-meeting-attendance-rosters.ts --commit  # write to DB
 */

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const commit = process.argv.includes("--commit");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const meetings = await prisma.scheduledMeeting.findMany({
    where: {
      status: { not: "Cancelled" },
      participantUserIds: { isEmpty: false },
      attendance: { none: {} },
    },
    select: { id: true, title: true, organizerId: true, participantUserIds: true },
  });

  console.log(`Found ${meetings.length} meeting(s) with guests but no roster.`);

  let created = 0;
  for (const m of meetings) {
    const attendeeIds = Array.from(new Set([...m.participantUserIds, m.organizerId]));
    console.log(
      `[${commit ? "WRITE" : "DRY"}] "${m.title}" (${m.id}): ${attendeeIds.length} row(s)`,
    );
    if (commit) {
      await prisma.meetingAttendance.createMany({
        data: attendeeIds.map((userId) => ({ scheduledMeetingId: m.id, userId })),
        skipDuplicates: true,
      });
    }
    created += attendeeIds.length;
  }

  console.log(
    `\nDone. ${meetings.length} meeting(s), ${created} attendance row(s)` +
      (commit ? " written." : " would be written (dry run — pass --commit)."),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
