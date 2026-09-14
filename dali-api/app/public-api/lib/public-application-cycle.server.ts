import { getActiveCycle } from "~/hiring/lib/cycles";

// The current hiring cycle as dali.website's Apply page sees it. The site
// renders one card from this: "Applications Are Open" with a deadline, or
// nothing at all.
//
// Note this is a NARROWER notion of "active" than ~/hiring/lib/cycles'
// ACTIVE_STATUSES (Open | UnderReview). Internally a cycle stays active while
// reviewers read and interview; publicly that stage is closed — submissions
// are no longer accepted, so advertising it as open would send applicants to a
// form they can't fill. Only `Open` is public-open here.
//
// Only Standard cycles are considered. Fellowship and Core cycles are internal
// conversions for people already in the lab; they run off the hiring portal's
// eligibility gate, never a public application, so they must not light up the
// public banner.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type PublicCycleDate = {
  day: number;
  month: string;
  year: number;
  time: string;
  fullDate: string; // ISO 8601
};

export type PublicApplicationCycle = {
  status: "open" | "closed";
  // Lead-authored label (e.g. "Fall 2026"). Null when nothing is open — the
  // site has no cycle to name.
  name: string | null;
  // The application deadline, if the cycle has one. A cycle may be Open with
  // no closeDate set yet (leads often open before fixing the date), in which
  // case the site falls back to generic copy.
  closeDate: PublicCycleDate | null;
};

const CLOSED: PublicApplicationCycle = {
  status: "closed",
  name: null,
  closeDate: null,
};

// Mirrors toDateParts in public-offerings.server.ts: the site renders the
// parts separately, and times are Eastern because the deadline is a campus
// deadline, not a viewer-local one.
function toDateParts(d: Date): PublicCycleDate {
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

export async function getPublicApplicationCycle(): Promise<PublicApplicationCycle> {
  const cycle = await getActiveCycle("Standard");
  // getActiveCycle already derives UnderReview for an Open cycle past its
  // closeDate, so a currentStatus of "Open" here means the deadline hasn't
  // passed. No second clock check needed.
  if (!cycle || cycle.currentStatus !== "Open") return CLOSED;

  return {
    status: "open",
    name: cycle.name,
    closeDate: cycle.closeDate ? toDateParts(cycle.closeDate) : null,
  };
}
