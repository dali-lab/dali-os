// Who is *currently* on a project — the gate for project-activity notifications.
//
// Task/file notification audiences are built from stakeholders (task assignees,
// file uploaders, past comment authors). Those sets are sticky: a member who
// rolls off the project stays a historical assignee/author forever, so without
// a membership gate they keep receiving the project's task and file activity.
// Intersecting the audience with this set stops that.
//
// "Currently on the project" spans both staffing shapes for the current term:
//   - ProjectAssignment — the staffed roster (term-scoped)
//   - ExternalMentor    — non-roster mentors placed on the project (cycle-scoped)
// so a currently-active external mentor still hears replies to their feedback.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";

export async function currentProjectParticipantIds(
  projectId: string,
): Promise<Set<string>> {
  const term = await currentTerm();
  if (!term) return new Set();

  const [assignments, externalMentors] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { projectId, termId: term.id },
      select: { userId: true },
    }),
    prisma.externalMentor.findMany({
      where: { projectId, staffingCycle: { termId: term.id } },
      select: { userId: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const a of assignments) ids.add(a.userId);
  for (const m of externalMentors) ids.add(m.userId);
  return ids;
}
