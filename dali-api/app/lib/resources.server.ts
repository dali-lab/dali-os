import { requireLabViewer, labMemberOrCore } from "~/lib/lab-viewer.server";
import { getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

// Who Resources is for: behind the `community` flag, lab members and Core.
// Null = no access. Takes a user id, not a session, so the MCP tools share it.
export async function resourcesAccess(
  userId: string,
  request?: Request,
): Promise<{ core: boolean } | null> {
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("community", userId, roles, request))) return null;
  const [core, labMember] = await Promise.all([
    isCore(userId, request),
    isLabMember(userId, request),
  ]);
  return core || labMember ? { core } : null;
}

// Child routes load in parallel with the layout, so each loader and action runs this itself.
export async function requireResourcesViewer(request: Request) {
  const { user, roles } = await requireLabViewer(request, {
    flag: "community",
    allow: labMemberOrCore,
  });

  return {
    user,
    core: roles.isCore,
    userName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
  };
}
