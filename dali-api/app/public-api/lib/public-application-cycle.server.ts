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

export type PublicApplicationCycle = {
  status: "open" | "closed";
  // Lead-authored label (e.g. "Fall 2026"). Null when nothing is open — the
  // site has no cycle to name.
  name: string | null;
  // ISO 8601 application deadline. Null when nothing is open, or when the cycle
  // is Open with no closeDate set yet (leads often open before fixing the
  // date), in which case the site falls back to generic copy. dali.website
  // formats it — the API ships the instant, not a rendering.
  closeDate: string | null;
};

const CLOSED: PublicApplicationCycle = {
  status: "closed",
  name: null,
  closeDate: null,
};

export async function getPublicApplicationCycle(): Promise<PublicApplicationCycle> {
  const cycle = await getActiveCycle("Standard");
  // getActiveCycle already derives UnderReview for an Open cycle past its
  // closeDate, so a currentStatus of "Open" here means the deadline hasn't
  // passed. No second clock check needed.
  if (!cycle || cycle.currentStatus !== "Open") return CLOSED;

  return {
    status: "open",
    name: cycle.name,
    closeDate: cycle.closeDate ? cycle.closeDate.toISOString() : null,
  };
}
