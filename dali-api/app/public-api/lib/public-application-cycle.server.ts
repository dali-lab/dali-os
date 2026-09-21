import { getOpenCycles } from "~/hiring/lib/cycles";

// The hiring cycles as dali.website's Apply page sees them: every Students
// cycle currently accepting applications, and by when. The site renders one
// card per cycle, or nothing at all.
//
// Only `Open` counts here, a NARROWER notion than ~/hiring/lib/cycles'
// ACTIVE_STATUSES (Open | UnderReview). Internally a cycle stays active while
// reviewers read and interview; publicly that stage is closed — submissions
// are no longer accepted, so advertising it as open would send applicants to a
// form they can't fill. getOpenCycles already derives UnderReview for an Open
// cycle past its closeDate, so no second clock check is needed.
//
// Only Students cycles are considered. Interns and Lab members cycles are for
// people already in the lab; they run off the hiring portal's eligibility gate,
// never a public application, so they must not light up the public banner.

export type PublicApplicationCycle = {
  status: "open" | "closed";
  // Lead-authored label (e.g. "Fall 2026"). Null only in the closed shape.
  name: string | null;
  // ISO 8601 application deadline. Null in the closed shape, or when the cycle
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

/** Every open Students cycle, soonest deadline first (no deadline last). */
export async function getPublicApplicationCycles(): Promise<PublicApplicationCycle[]> {
  const cycles = await getOpenCycles({ applicants: "Students" });
  const deadline = (c: (typeof cycles)[number]) => c.closeDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return cycles
    .sort((a, b) => (deadline(a) === deadline(b) ? 0 : deadline(a) - deadline(b)))
    .map((c) => ({
      status: "open",
      name: c.name,
      closeDate: c.closeDate ? c.closeDate.toISOString() : null,
    }));
}

/** The response body: all open cycles, plus the single-cycle `cycle` field the
 *  site read before several cycles could be open. `cycle` is the soonest-closing
 *  open cycle (or closed) and stays for one release while the site moves to
 *  `cycles`. */
export async function getPublicApplicationCycleResponse() {
  const cycles = await getPublicApplicationCycles();
  return { cycles, cycle: cycles[0] ?? CLOSED };
}
