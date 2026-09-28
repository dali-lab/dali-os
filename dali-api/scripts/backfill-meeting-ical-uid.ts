/**
 * Backfill ScheduledMeeting.iCalUID for meetings pushed to Google before the
 * iCalUID join key existed.
 *
 * Why: the calendar ties a fetched Google event back to its meeting by iCalUID
 * (stable across attendee copies and recurring instances). Rows created before
 * this still only have externalEventId (the mutable per-copy event id), so a
 * detached instance — one Google handed a viewer without recurringEventId —
 * can't resolve and shows as a plain Google event (no note/attendance). New
 * meetings capture the UID at push time; the calendar read path also self-heals
 * opportunistically, but this fills every row deterministically without waiting
 * for a well-formed instance to appear in someone's window.
 *
 * Reads each meeting's iCalUID from Google via its stored organizer link +
 * calendar + event id. Idempotent; safe to re-run. Dry run by default.
 *
 * Usage:
 *   npx tsx scripts/backfill-meeting-ical-uid.ts           # dry run
 *   npx tsx scripts/backfill-meeting-ical-uid.ts --commit  # write
 */

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { getGoogleEvent } from "../app/lib/google-calendar";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const commit = process.argv.includes("--commit");

  const meetings = await prisma.scheduledMeeting.findMany({
    where: {
      iCalUID: null,
      externalEventId: { not: null },
      organizerCalendarLinkId: { not: null },
    },
    select: {
      id: true,
      title: true,
      externalEventId: true,
      organizerCalendarLinkId: true,
      organizerCalendarId: true,
    },
  });

  console.log(`${meetings.length} meeting(s) missing iCalUID.`);
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const m of meetings) {
    try {
      const ev = await getGoogleEvent({
        linkId: m.organizerCalendarLinkId!,
        calendarId: m.organizerCalendarId ?? undefined,
        eventId: m.externalEventId!,
      });
      if (!ev.iCalUID) {
        skipped++;
        console.warn(`  skip ${m.id} "${m.title}" — Google returned no iCalUID`);
        continue;
      }
      if (commit) {
        await prisma.scheduledMeeting.update({
          where: { id: m.id },
          data: { iCalUID: ev.iCalUID },
        });
      }
      updated++;
      console.log(`  ${commit ? "set" : "would set"} ${m.id} "${m.title}" → ${ev.iCalUID}`);
    } catch (err) {
      // A deleted event / revoked token / lost access shouldn't stop the run.
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  fail ${m.id} "${m.title}" — ${msg}`);
    }
  }

  console.log(
    `\nDone. ${updated} ${commit ? "updated" : "to update"}, ${skipped} no-UID, ${failed} failed.` +
      (commit ? "" : " (dry run — pass --commit to write)"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
