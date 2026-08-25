import { prisma } from "~/lib/db";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";

// Published education offerings for dali.website — the offerings section and a
// calendar view both read from here. This module's exported types ARE the
// contract the site renders from: an offering spans a date range with multiple
// sessions, so the payload carries the range, the full session schedule, and
// the registration window rather than a single date.
//
// Which slice of the catalog comes back is controlled by query params (see
// parseOfferingsFilter). Only Published offerings are ever returned — Draft and
// Archived stay private, matching what the in-app catalog shows.

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
  term: string | null; // term code (e.g. "26F"), null if outside any term
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

// `upcoming` = not yet started, `past` = already ended, `all` = the whole
// published catalog (including currently-running offerings).
export type OfferingScope = "upcoming" | "past" | "all";

export type OfferingsFilter = {
  scope?: OfferingScope; // defaults to "upcoming"; ignored when from/to are set
  from?: Date; // calendar window lower bound (interval overlap)
  to?: Date; // calendar window upper bound (interval overlap)
  term?: string; // term code (e.g. "26F"); limits to offerings in that term
  type?: "Miniseries" | "Workshop"; // limits to one offering type (DB enum)
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

type OfferingWhere = {
  status: "Published";
  term?: { code: string };
  type?: "Miniseries" | "Workshop";
  startsAt?: { gt?: Date; lte?: Date };
  endsAt?: { lt?: Date; gte?: Date };
};

function buildWhere(filter: OfferingsFilter, now: Date): OfferingWhere {
  const where: OfferingWhere = { status: "Published" };
  // Term and type compose with the date filters below (independent ANDs, e.g.
  // term=26F&type=workshop&scope=past).
  if (filter.term) where.term = { code: filter.term };
  if (filter.type) where.type = filter.type;

  // An explicit calendar window wins over scope: return every offering whose
  // run overlaps [from, to]. Either bound may be omitted (open-ended window).
  if (filter.from || filter.to) {
    if (filter.to) where.startsAt = { lte: filter.to };
    if (filter.from) where.endsAt = { gte: filter.from };
    return where;
  }

  // A term implies "the whole term" unless the caller narrows it; without a
  // term the default is the upcoming feed.
  switch (filter.scope ?? (filter.term ? "all" : "upcoming")) {
    case "upcoming":
      where.startsAt = { gt: now }; // hasn't started yet
      break;
    case "past":
      where.endsAt = { lt: now }; // already ended
      break;
    case "all":
      break; // whole published catalog
  }
  return where;
}

// Parse and validate the offerings query params. Returns the filter or a
// human-readable error the route turns into a 400.
export function parseOfferingsFilter(
  params: URLSearchParams,
): { filter: OfferingsFilter } | { error: string } {
  let scope: OfferingScope | undefined;
  const scopeRaw = params.get("scope");
  if (scopeRaw != null) {
    if (scopeRaw !== "upcoming" && scopeRaw !== "past" && scopeRaw !== "all") {
      return { error: "Invalid 'scope' (use upcoming, past, or all)" };
    }
    scope = scopeRaw;
  }

  const filter: OfferingsFilter = { scope };
  const term = params.get("term")?.trim();
  if (term) filter.term = term;

  // `type` comes in lowercase (matching the payload) but maps to the DB enum.
  const typeRaw = params.get("type");
  if (typeRaw != null && typeRaw.trim() !== "") {
    const t = typeRaw.trim().toLowerCase();
    if (t === "miniseries") filter.type = "Miniseries";
    else if (t === "workshop") filter.type = "Workshop";
    else return { error: "Invalid 'type' (use miniseries or workshop)" };
  }

  for (const key of ["from", "to"] as const) {
    const raw = params.get(key);
    if (raw == null) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return { error: `Invalid '${key}' date` };
    filter[key] = d;
  }

  return { filter };
}

export async function listPublicOfferings(
  filter: OfferingsFilter = {},
  now: Date = new Date(),
): Promise<PublicOffering[]> {
  const rows = await prisma.educationOffering.findMany({
    where: buildWhere(filter, now),
    // Published offerings always have sessions (publish gate), so startsAt is
    // non-null here — a plain ascending sort is sufficient.
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
      term: { select: { code: true } },
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
        term: o.term?.code ?? null,
        // Published offerings always have sessions, so startsAt/endsAt are
        // guaranteed non-null by the publish gate.
        startDate: toDateParts(o.startsAt!),
        endDate: toDateParts(o.endsAt!),
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
