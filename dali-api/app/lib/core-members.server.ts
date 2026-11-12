import { prisma } from "~/lib/db.server";
import { getActiveCoreCycleTermIds } from "~/lib/roles";

export type CoreMemberOption = { userId: string; name: string };

type PersonNameFields = { firstName: string | null; lastName: string | null; daliEmail: string | null };

export function personName(user: PersonNameFields): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.daliEmail || "Unknown";
}

export async function listActiveCoreMembers(request: Request): Promise<CoreMemberOption[]> {
  const termIds = await getActiveCoreCycleTermIds(request);
  if (termIds.length === 0) return [];
  const assignments = await prisma.coreAssignment.findMany({
    where: { termId: { in: termIds } },
    select: {
      userId: true,
      user: { select: { firstName: true, lastName: true, daliEmail: true } },
    },
    distinct: ["userId"],
  });
  return assignments
    .map((a) => ({ userId: a.userId, name: personName(a.user) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Promotion copies the icon to the project, which owns it from then on.
export async function resolveApplicationIcon(application: {
  iconEmoji: string | null;
  resultingProjectId: string | null;
}): Promise<string | null> {
  if (!application.resultingProjectId) return application.iconEmoji;
  const project = await prisma.project.findUnique({
    where: { id: application.resultingProjectId },
    select: { iconEmoji: true },
  });
  return project?.iconEmoji ?? null;
}
