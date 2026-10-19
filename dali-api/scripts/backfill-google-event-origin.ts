/**
 * Backfill ScheduledMeeting.googleEventOrigin for rows that predate it.
 *
 * DALI only writes to a Google event it created. A split-series id
 * (`<base>_R<stamp>`) is never DALI-created, so it is Tracked outright. For
 * the rest, Google is asked who created the event: the meeting's own calendar
 * account means DALI pushed it (Created), anyone else means it was tracked.
 * A row Google can no longer read is left null (treated as Created) and listed.
 *
 * Idempotent; only touches rows whose origin is still null. Dry run by default.
 *
 * Usage:
 *   npx tsx scripts/backfill-google-event-origin.ts           # dry run
 *   npx tsx scripts/backfill-google-event-origin.ts --commit  # write
 */

import { PrismaClient } from "../app/generated/prisma/client.js";
import type { GoogleEventOrigin } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { getGoogleEvent } from "../app/lib/google-calendar";
import { googleSeriesBase } from "../app/lib/meeting-occurrences";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type Row = { id: string; title: string; externalEventId: string; origin: GoogleEventOrigin | null; why: string };

async function main() {
  const commit = process.argv.includes("--commit");

  const meetings = await prisma.scheduledMeeting.findMany({
    where: { externalEventId: { not: null }, googleEventOrigin: null },
    select: {
      id: true,
      title: true,
      externalEventId: true,
      organizerCalendarId: true,
      organizerCalendarLinkId: true,
      organizerCalendarLink: { select: { externalEmail: true } },
    },
  });

  console.log(`${meetings.length} meeting(s) with no origin.`);
  const rows: Row[] = [];

  for (const m of meetings) {
    const externalEventId = m.externalEventId!;
    const row = { id: m.id, title: m.title, externalEventId };
    if (googleSeriesBase(externalEventId) !== externalEventId) {
      rows.push({ ...row, origin: "Tracked", why: "split series id" });
      continue;
    }
    if (!m.organizerCalendarLinkId || !m.organizerCalendarLink) {
      rows.push({ ...row, origin: null, why: "no calendar link" });
      continue;
    }
    try {
      const ev = await getGoogleEvent({
        linkId: m.organizerCalendarLinkId,
        calendarId: m.organizerCalendarId ?? undefined,
        eventId: externalEventId,
      });
      const creator = (ev.creatorEmail ?? ev.organizerEmail)?.toLowerCase();
      const linkEmail = m.organizerCalendarLink.externalEmail.toLowerCase();
      rows.push(
        creator === linkEmail
          ? { ...row, origin: "Created", why: "creator is the link account" }
          : { ...row, origin: "Tracked", why: `creator is ${creator ?? "unknown"}` },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({ ...row, origin: null, why: `unreadable: ${msg}` });
    }
  }

  console.table(rows.map((r) => ({ id: r.id, title: r.title, event: r.externalEventId, origin: r.origin ?? "(left null)", why: r.why })));

  if (commit) {
    for (const r of rows) {
      if (!r.origin) continue;
      await prisma.scheduledMeeting.update({ where: { id: r.id }, data: { googleEventOrigin: r.origin } });
    }
  }

  const count = (o: GoogleEventOrigin | null) => rows.filter((r) => r.origin === o).length;
  console.log(
    `\nDone. ${count("Created")} Created, ${count("Tracked")} Tracked, ${count(null)} left null.` +
      (commit ? "" : " (dry run, pass --commit to write)"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
