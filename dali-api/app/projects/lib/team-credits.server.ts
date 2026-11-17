import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";

// Credit lines for a set of projects in one query, rather than one per
// project — the public list endpoint serves every published project at once.
export async function teamMembersByProject(
  projectIds: string[],
): Promise<Map<string, string[]>> {
  if (projectIds.length === 0) return new Map();
  const rows = await prisma.projectAssignment.findMany({
    where: { projectId: { in: projectIds } },
    select: {
      projectId: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  // Dedupe per project: a member staffed across several terms or domains is
  // one credit, not several.
  const seen = new Map<string, Map<string, string>>();
  for (const r of rows) {
    let forProject = seen.get(r.projectId);
    if (!forProject) {
      forProject = new Map();
      seen.set(r.projectId, forProject);
    }
    forProject.set(r.user.id, fullName(r.user));
  }
  return new Map(
    [...seen].map(([projectId, users]) => [
      projectId,
      [...users.values()].sort((a, b) => a.localeCompare(b)),
    ]),
  );
}
