/**
 * Backfill ScheduledMeeting.googleEventOrigin for rows that predate it, and
 * find meetings whose Google event was deleted.
 *
 * DALI only writes to a Google event it created. A split-series id
 * (`<base>_R<stamp>`) is never DALI-created, so it is Tracked outright. For
 * the rest, Google is asked who created the event: the meeting's own calendar
 * account means DALI pushed it (Created), anyone else means it was tracked.
 *
 * Tracked rows made before organizerCalendarId was stored point at the
 * tracker's primary calendar, where a general-calendar event 404s. A 404 is
 * retried on the general calendar, and a hit there stores its calendar id.
 * A 404 on both is not proof of deletion, so that row is only listed. Only an
 * event Google reports as `cancelled` counts as deleted.
 *
 * Idempotent. Dry run by default.
 *
 * Usage:
 *   npx tsx scripts/backfill-google-event-origin.ts                                # dry run
 *   npx tsx scripts/backfill-google-event-origin.ts --commit                       # write origins
 *   npx tsx scripts/backfill-google-event-origin.ts --commit --cancel-deleted      # also cancel deleted ones
 *
 * Needs DATABASE_URL, CALENDAR_TOKEN_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 * and DALI_GENERAL_CALENDAR_ICS (or DALI_GENERAL_CALENDAR_ID) from prod.
 */

import { PrismaClient } from "../app/generated/prisma/client.js";
import type { GoogleEventOrigin } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { getGoogleEvent } from "../app/lib/google-calendar";
import { generalCalendarId } from "../app/lib/general-calendar";
import { googleSeriesBase } from "../app/lib/meeting-occurrences";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type Row = {
  id: string;
  title: string;
  externalEventId: string;
  origin: GoogleEventOrigin | null;
  calendarId: string | null;
  deleted: boolean;
  why: string;
};

type Read = Awaited<ReturnType<typeof getGoogleEvent>>;

async function read(linkId: string, calendarId: string | null, eventId: string): Promise<Read | "missing"> {
  try {
    return await getGoogleEvent({ linkId, calendarId: calendarId ?? undefined, eventId });
  } catch (err) {
    if (err instanceof Error && /\((404|410)\)/.test(err.message)) return "missing";
    throw err;
  }
}

async function main() {
  const commit = process.argv.includes("--commit");
  const cancelDeleted = process.argv.includes("--cancel-deleted");
  const general = generalCalendarId();
  if (!general) console.warn("No general calendar configured; 404s won't be retried there.");

  const meetings = await prisma.scheduledMeeting.findMany({
    where: { externalEventId: { not: null }, status: { not: "Cancelled" } },
    select: {
      id: true,
      title: true,
      externalEventId: true,
      googleEventOrigin: true,
      organizerCalendarId: true,
      organizerCalendarLinkId: true,
      organizerCalendarLink: { select: { externalEmail: true } },
    },
  });

  console.log(`${meetings.length} live meeting(s) with a Google event.`);
  const rows: Row[] = [];

  for (const m of meetings) {
    const externalEventId = m.externalEventId!;
    const base = {
      id: m.id,
      title: m.title,
      externalEventId,
      origin: m.googleEventOrigin,
      calendarId: null as string | null,
      deleted: false,
    };
    const split = googleSeriesBase(externalEventId) !== externalEventId;
    if (!m.organizerCalendarLinkId || !m.organizerCalendarLink) {
      rows.push({ ...base, origin: base.origin ?? (split ? "Tracked" : null), why: "no calendar link" });
      continue;
    }
    try {
      let ev = await read(m.organizerCalendarLinkId, m.organizerCalendarId, externalEventId);
      let calendarId: string | null = null;
      if (ev === "missing" && general && m.organizerCalendarId !== general) {
        ev = await read(m.organizerCalendarLinkId, general, externalEventId);
        if (ev !== "missing") calendarId = general;
      }
      if (ev === "missing") {
        rows.push({
          ...base,
          origin: base.origin ?? (split ? "Tracked" : null),
          why: "404 on its calendar and the general calendar (not treated as deleted)",
        });
        continue;
      }
      const creator = (ev.creatorEmail ?? ev.organizerEmail)?.toLowerCase();
      const linkEmail = m.organizerCalendarLink.externalEmail.toLowerCase();
      const origin: GoogleEventOrigin =
        base.origin ?? (split || calendarId || creator !== linkEmail ? "Tracked" : "Created");
      const deleted = ev.status === "cancelled";
      const why = [
        split ? "split series id" : creator === linkEmail ? "creator is the link account" : `creator is ${creator ?? "unknown"}`,
        calendarId ? "found on the general calendar" : null,
        deleted ? "DELETED in Google" : null,
      ]
        .filter(Boolean)
        .join("; ");
      rows.push({ ...base, origin, calendarId, deleted, why });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({ ...base, origin: base.origin ?? (split ? "Tracked" : null), why: `unreadable: ${msg}` });
    }
  }

  const changed = rows.filter((r) => {
    const m = meetings.find((x) => x.id === r.id)!;
    return r.origin !== m.googleEventOrigin || r.calendarId || r.deleted || !r.origin;
  });
  console.table(
    changed.map((r) => ({
      id: r.id,
      title: r.title,
      event: r.externalEventId,
      origin: r.origin ?? "(left null)",
      deleted: r.deleted ? "yes" : "",
      why: r.why,
    })),
  );

  if (commit) {
    for (const r of rows) {
      const m = meetings.find((x) => x.id === r.id)!;
      const data = {
        ...(r.origin && r.origin !== m.googleEventOrigin ? { googleEventOrigin: r.origin } : {}),
        ...(r.calendarId ? { organizerCalendarId: r.calendarId } : {}),
        ...(cancelDeleted && r.deleted ? { status: "Cancelled" as const } : {}),
      };
      if (Object.keys(data).length > 0) await prisma.scheduledMeeting.update({ where: { id: r.id }, data });
    }
  }

  const count = (o: GoogleEventOrigin | null) => rows.filter((r) => r.origin === o).length;
  const deleted = rows.filter((r) => r.deleted).length;
  console.log(
    `\nDone. ${count("Created")} Created, ${count("Tracked")} Tracked, ${count(null)} left null. ` +
      `${rows.filter((r) => r.calendarId).length} found on the general calendar. ` +
      `${deleted} deleted in Google` +
      (cancelDeleted ? (commit ? " (cancelled in DALI)." : " (would be cancelled).") : " (pass --cancel-deleted to cancel them).") +
      (commit ? "" : " Dry run, pass --commit to write."),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
