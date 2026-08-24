import { prisma } from "~/lib/db";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";

// Upcoming (not-yet-started) published education offerings for dali.website's
// offerings calendar. This module's exported types ARE the contract the site
// renders from — an offering spans a date range with multiple sessions, so the
// payload carries the range, the full session schedule, and the registration
// window rather than a single date.

export type PublicOfferingDate = {
  day: number;
  month: string;
  year: number;
  time: string;
  fullDate: string; // ISO 8601
};

export type PublicOfferingSession = {
  sequence: number;
  title: string | null;
  location: string | null;
  date: PublicOfferingDate;
};

export type PublicOffering = {
  id: string;
  name: string;
  description: string;
  type: string; // lowercased offering type: "miniseries" | "workshop"
  startDate: PublicOfferingDate;
  endDate: PublicOfferingDate;
  sessions: PublicOfferingSession[];
  registration: {
    opensAt: PublicOfferingDate;
    closesAt: PublicOfferingDate;
    open: boolean;
  };
  signUpLink: string;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The site renders the parts separately, so it gets parts rather than a
// formatted string, plus an ISO `fullDate` for anything that needs the raw
// value. Times are rendered in Eastern — the lab is one campus and every
// offering happens on it, so a viewer's local zone would be misleading rather
// than helpful.
function toDateParts(d: Date): PublicOfferingDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minute = get("minute");
  const hour = get("hour");
  const dayPeriod = get("dayPeriod").toUpperCase();
  return {
    day: Number(get("day")),
    month: MONTHS[Number(get("month")) - 1],
    year: Number(get("year")),
    time: minute === "00" ? `${hour} ${dayPeriod}` : `${hour}:${minute} ${dayPeriod}`,
    fullDate: d.toISOString(),
  };
}

export async function listPublicOfferings(
  now: Date = new Date(),
): Promise<PublicOffering[]> {
  const rows = await prisma.educationOffering.findMany({
    // "Upcoming" = published and not yet started. An offering drops off the
    // public feed the moment its first session begins, even if it's still
    // mid-run or accepting late registration.
    where: { status: "Published", startsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      title: true,
      type: true,
      descriptionDocId: true,
      applicationFormId: true,
      startsAt: true,
      endsAt: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
      sessions: {
        orderBy: { sequence: "asc" },
        select: { sequence: true, title: true, location: true, datetime: true },
      },
    },
  });

  return Promise.all(
    rows.map(async (o) => {
      // The description lives in a collab doc; the site's calendar cards show
      // a plain-text blurb, so flatten rather than shipping blocks it can't
      // render.
      const description = o.descriptionDocId
        ? blocksToPlainText(await readDocAsBlocks(o.descriptionDocId)).trim()
        : "";
      return {
        id: o.id,
        name: o.title,
        description,
        // The site keys its filter chips off lowercase type names.
        type: o.type.toLowerCase(),
        startDate: toDateParts(o.startsAt),
        endDate: toDateParts(o.endsAt),
        sessions: o.sessions.map((s) => ({
          sequence: s.sequence,
          title: s.title,
          location: s.location,
          date: toDateParts(s.datetime),
        })),
        registration: {
          opensAt: toDateParts(o.registrationOpensAt),
          closesAt: toDateParts(o.registrationClosesAt),
          open:
            o.registrationOpensAt.getTime() <= now.getTime() &&
            now.getTime() <= o.registrationClosesAt.getTime(),
        },
        // Offerings apply through the shared Forms system. Null form = not
        // open yet; "#" matches what the site already renders for that case.
        signUpLink: o.applicationFormId
          ? `${process.env.FRONTEND_URL ?? ""}/education/${o.id}`
          : "#",
      };
    }),
  );
}
