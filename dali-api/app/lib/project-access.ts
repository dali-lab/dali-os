import { isCore, isProjectMember } from "~/lib/roles";

export async function canEditProject(
  userId: string,
  projectId: string,
  request?: Request,
): Promise<boolean> {
  const rest = request ? [request] : [];
  const [core, member] = await Promise.all([
    isCore(userId, ...(rest as [Request?])),
    isProjectMember(userId, projectId, ...(rest as [Request?])),
  ]);
  return core || member;
}
