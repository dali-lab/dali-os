import { requireLabViewer, labMemberOrCore } from "~/lib/lab-viewer.server";
import { isCore, isLabMemberOrAlum } from "~/lib/roles";

// Who Resources is for: lab members and Core.
// Null = no access. Takes a user id, not a session, so the MCP tools share it.
export async function resourcesAccess(
  userId: string,
  request?: Request,
): Promise<{ core: boolean } | null> {
  const [core, labMember] = await Promise.all([
    isCore(userId, request),
    isLabMemberOrAlum(userId, request),
  ]);
  return core || labMember ? { core } : null;
}

// Child routes load in parallel with the layout, so each loader and action runs this itself.
export async function requireResourcesViewer(request: Request) {
  const { user, roles } = await requireLabViewer(request, { allow: labMemberOrCore });

  return {
    user,
    core: roles.isCore,
    userName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
  };
}
