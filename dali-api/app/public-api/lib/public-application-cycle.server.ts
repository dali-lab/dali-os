import { prisma } from "~/lib/db";
import { getOpenCycles } from "~/hiring/lib/cycles";
import { domainCloseDate, earliestCloseDate } from "~/hiring/lib/domain-windows";

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
  // ISO 8601 deadline: the EARLIEST of this cycle's ready domains' effective
  // closes — the conservative single date when domains close on different
  // schedules (app/hiring/lib/domain-windows.ts). Null in the closed shape,
  // or when the cycle has no ready domain with a close date at all.
  // dali.website formats it — the API ships the instant, not a rendering.
  closeDate: string | null;
  // Every ready domain, soonest close first, for a site that wants to show
  // more than the one-date fallback above.
  domains: { name: string; closeDate: string | null }[];
};

const CLOSED: PublicApplicationCycle = {
  status: "closed",
  name: null,
  closeDate: null,
  domains: [],
};

/** Every open Students cycle, soonest deadline first (no deadline last). */
export async function getPublicApplicationCycles(): Promise<PublicApplicationCycle[]> {
  const cycles = await getOpenCycles({ applicants: "Students" });
  if (cycles.length === 0) return [];

  const domainRows = await prisma.domainApplicationCycle.findMany({
    where: { applicationCycleId: { in: cycles.map((c) => c.id) }, isReady: true },
    select: { applicationCycleId: true, closeDate: true, domain: { select: { name: true } } },
  });
  const domainsByCycleId = new Map<string, typeof domainRows>();
  for (const row of domainRows) {
    const arr = domainsByCycleId.get(row.applicationCycleId) ?? [];
    arr.push(row);
    domainsByCycleId.set(row.applicationCycleId, arr);
  }

  const deadline = (c: (typeof cycles)[number]) => c.closeDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return cycles
    .sort((a, b) => (deadline(a) === deadline(b) ? 0 : deadline(a) - deadline(b)))
    .map((c) => {
      const rows = domainsByCycleId.get(c.id) ?? [];
      const domains = rows
        .map((r) => ({ name: r.domain.name, closeDate: domainCloseDate(r, c) }))
        .sort(
          (a, b) =>
            (a.closeDate?.getTime() ?? Number.POSITIVE_INFINITY) -
            (b.closeDate?.getTime() ?? Number.POSITIVE_INFINITY),
        )
        .map((d) => ({ name: d.name, closeDate: d.closeDate ? d.closeDate.toISOString() : null }));
      const earliest = earliestCloseDate(rows, c);
      return {
        status: "open" as const,
        name: c.name,
        closeDate: earliest ? earliest.toISOString() : null,
        domains,
      };
    });
}

/** The response body: all open cycles, plus the single-cycle `cycle` field the
 *  site read before several cycles could be open. `cycle` is the soonest-closing
 *  open cycle (or closed) and stays for one release while the site moves to
 *  `cycles`. */
export async function getPublicApplicationCycleResponse() {
  const cycles = await getPublicApplicationCycles();
  return { cycles, cycle: cycles[0] ?? CLOSED };
}
