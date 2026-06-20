// Server-side roster loaders for @-mention resolution. Each function
// returns a `Candidate[]` matching the pure resolver's shape in
// `lib/mentions.ts`. Callers compose with `resolveMentions(body, roster)`.

import { prisma } from "~/lib/db";
import type { Candidate } from "~/lib/mentions";

/**
 * Roster for an education offering: instructors + Approved enrollees.
 * Deduped by userId.
 */
export async function loadOfferingRoster(offeringId: string): Promise<Candidate[]> {
  const [enrollees, instructors] = await Promise.all([
    prisma.educationApplication.findMany({
      where: { offeringId, status: "Approved" },
      select: {
        applicant: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.instructorAssignment.findMany({
      where: { offeringId },
      select: { user: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);
  const byId = new Map<string, Candidate>();
  for (const e of enrollees) byId.set(e.applicant.id, e.applicant);
  for (const i of instructors) byId.set(i.user.id, i.user);
  return Array.from(byId.values());
}

/**
 * Roster for a project workspace: every member with a current ProjectAssignment
 * on the project. Used by task comments / document comments scoped to the
 * project. Deduped by userId.
 */
export async function loadProjectRoster(projectId: string): Promise<Candidate[]> {
  const rows = await prisma.projectAssignment.findMany({
    where: { projectId },
    select: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  const byId = new Map<string, Candidate>();
  for (const r of rows) byId.set(r.user.id, r.user);
  return Array.from(byId.values());
}

/**
 * Roster for the whole lab: every current DALIMember. Used when there is no
 * tighter project / offering scope (e.g. lab-wide pages).
 */
export async function loadLabRoster(): Promise<Candidate[]> {
  const rows = await prisma.dALIMember.findMany({
    select: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  return rows.map((r) => r.user);
}
