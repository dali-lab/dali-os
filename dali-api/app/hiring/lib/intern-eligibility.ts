import { prisma } from "~/lib/db";
import { currentTermStrict } from "~/lib/roles";

// A user is eligible to apply to an InternToFull cycle iff they currently
// hold a ProjectAssignment in the active term where the project's domain is
// flagged as an intern program. `currentTermStrict` ensures the window
// between intern terms fails closed (no roll-forward to the next term).
export async function isInternToFullEligible(userId: string): Promise<boolean> {
  const activeTerm = await currentTermStrict();
  if (!activeTerm) return false;

  const assignment = await prisma.projectAssignment.findFirst({
    where: {
      userId,
      termId: activeTerm.id,
      domain: { isInternProgram: true },
    },
    select: { id: true },
  });
  return assignment != null;
}

// Returns user IDs of everyone currently eligible for an InternToFull cycle:
// any DALI member with a ProjectAssignment in the active term whose domain
// is flagged as an intern program. Used to fan out the "cycle is open"
// notification. Returns [] when no term is currently active.
export async function eligibleInternUserIds(): Promise<string[]> {
  const activeTerm = await currentTermStrict();
  if (!activeTerm) return [];

  const rows = await prisma.projectAssignment.findMany({
    where: {
      termId: activeTerm.id,
      domain: { isInternProgram: true },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}

// Returns the intern-program domains the user is currently assigned in.
// Used to surface "you're converting from <X>" hints in the applicant UI
// and reviewer view. Empty when the user is not a current-term intern.
export async function currentInternDomains(userId: string) {
  const activeTerm = await currentTermStrict();
  if (!activeTerm) return [];

  const assignments = await prisma.projectAssignment.findMany({
    where: {
      userId,
      termId: activeTerm.id,
      domain: { isInternProgram: true },
    },
    include: { domain: true },
  });
  const seen = new Set<string>();
  const out: { id: string; code: string; displayName: string }[] = [];
  for (const a of assignments) {
    if (seen.has(a.domain.id)) continue;
    seen.add(a.domain.id);
    out.push({ id: a.domain.id, code: a.domain.code, displayName: a.domain.displayName });
  }
  return out;
}
