import { prisma } from "~/lib/db";
import { termCodeForDate, termWindows, type TermWindow } from "~/lib/terms";
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

// All datetimes are ISO 8601 strings. dali.website formats them — month names,
// times, and the campus timezone are its call, not the API's. Shipping the raw
// instant keeps this a data endpoint (see the sibling application-cycle).
export type PublicOfferingSession = {
  sequence: number;
  title: string | null;
  location: string | null;
  date: string; // ISO 8601
};

export type PublicOffering = {
  id: string;
  name: string;
  description: string;
  type: string; // lowercased offering type: "miniseries" | "fellowship" | "workshop"
  // Term code (e.g. "26F"), derived from the start date; null when the run
  // starts outside every term window.
  term: string | null;
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  sessions: PublicOfferingSession[];
  registration: {
    opensAt: string; // ISO 8601
    closesAt: string; // ISO 8601
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
  term?: string; // term code (e.g. "26F"); limits to offerings starting in that term's date window
  type?: "Miniseries" | "Fellowship" | "Workshop"; // limits to one offering type (DB enum)
};

type DateClause = {
  startsAt?: { gt?: Date; gte?: Date; lte?: Date };
  endsAt?: { lt?: Date; gte?: Date };
};

type OfferingWhere = {
  status: "Published";
  type?: "Miniseries" | "Fellowship" | "Workshop";
  AND?: DateClause[];
};

/**
 * `termWindow` is the resolved date window for `filter.term` (the caller looks
 * it up — a term is a date range here, not a stored relation). Date clauses go
 * in an AND array rather than one merged object so a term window and a
 * scope/calendar bound can both constrain `startsAt` without overwriting each
 * other.
 */
function buildWhere(
  filter: OfferingsFilter,
  now: Date,
  termWindow: TermWindow | null,
): OfferingWhere {
  const where: OfferingWhere = { status: "Published" };
  // Term and type compose with the date filters below (independent ANDs, e.g.
  // term=26F&type=workshop&scope=past).
  if (filter.type) where.type = filter.type;

  const and: DateClause[] = [];
  // "In term 26F" = the run starts inside 26F's window, the same rule that
  // used to set the offering's termId column.
  if (termWindow) {
    and.push({ startsAt: { gte: termWindow.startDate, lte: termWindow.endDate } });
  }

  // An explicit calendar window wins over scope: return every offering whose
  // run overlaps [from, to]. Either bound may be omitted (open-ended window).
  if (filter.from || filter.to) {
    if (filter.to) and.push({ startsAt: { lte: filter.to } });
    if (filter.from) and.push({ endsAt: { gte: filter.from } });
  } else {
    // A term implies "the whole term" unless the caller narrows it; without a
    // term the default is the upcoming feed.
    switch (filter.scope ?? (filter.term ? "all" : "upcoming")) {
      case "upcoming":
        and.push({ startsAt: { gt: now } }); // hasn't started yet
        break;
      case "past":
        and.push({ endsAt: { lt: now } }); // already ended
        break;
      case "all":
        break; // whole published catalog
    }
  }
  if (and.length > 0) where.AND = and;
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
    else if (t === "fellowship") filter.type = "Fellowship";
    else if (t === "workshop") filter.type = "Workshop";
    else return { error: "Invalid 'type' (use miniseries, fellowship, or workshop)" };
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
  const windows = await termWindows();
  // An unseeded/unknown term code matches nothing, as the old relation filter
  // on a nonexistent code did.
  const termWindow = filter.term
    ? (windows.find((w) => w.code === filter.term) ?? null)
    : null;
  if (filter.term && !termWindow) return [];

  const rows = await prisma.educationOffering.findMany({
    where: buildWhere(filter, now, termWindow),
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
      sessions: {
        orderBy: { sequence: "asc" },
        select: { sequence: true, title: true, location: true, datetime: true },
      },
    },
  });

  // startsAt/endsAt are nullable. A Published offering can still have both null
  // (no sessions yet — the publish gate is supposed to prevent it, but legacy /
  // edge rows exist in prod). Such an offering has no schedule to render, so
  // drop it here rather than crash the whole endpoint on a null `.toISOString()`.
  const scheduled = rows.filter((o) => o.startsAt !== null && o.endsAt !== null);

  return Promise.all(
    scheduled.map(async (o) => {
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
        term: termCodeForDate(windows, o.startsAt!),
        // Non-null: the filter above dropped any offering without a schedule.
        startDate: o.startsAt!.toISOString(),
        endDate: o.endsAt!.toISOString(),
        sessions: o.sessions.map((s) => ({
          sequence: s.sequence,
          title: s.title,
          location: s.location,
          date: s.datetime.toISOString(),
        })),
        registration: {
          opensAt: o.registrationOpensAt.toISOString(),
          closesAt: o.registrationClosesAt.toISOString(),
          open:
            o.registrationOpensAt.getTime() <= now.getTime() &&
            now.getTime() <= o.registrationClosesAt.getTime(),
        },
        // Offerings apply through the shared Forms system. Null form = not
        // open yet; "#" matches what the site already renders for that case.
        // Point at the /portal mirror, not the member-shell /education/:id: the
        // public audience is prospective (non-DALI) students, and the member
        // shell bounces a Dartmouth account with no DALIMember row straight to
        // /portal, dropping the offering. The portal offering page serves
        // dartmouth/partner users directly and redirects actual members back to
        // /education/:id, so this one link lands both audiences correctly.
        signUpLink: o.applicationFormId
          ? `${process.env.FRONTEND_URL ?? ""}/portal/education/${o.id}`
          : "#",
      };
    }),
  );
}
