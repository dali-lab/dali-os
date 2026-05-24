// `whoami` MCP tool — returns identity + role tier for the authenticated
// member. Trivial by design; this tool exists to validate the auth path
// end-to-end. Requires the `mcp:read` scope.

import { getUserRoles } from "~/lib/roles";

export const WHOAMI_TOOL = {
  name: "whoami",
  description: "Return the authenticated DALI OS member's identity and role tier.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export type WhoamiUser = {
  id: string;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  netId: string | null;
  firstName: string;
  lastName: string;
};

export async function runWhoami(user: WhoamiUser) {
  const roles = await getUserRoles(user.id);
  // Coarse, externally-stable tier label.
  let tier: "admin" | "core" | "domain-lead" | "member" | "non-member";
  if (roles.isAdmin) tier = "admin";
  else if (roles.isCore) tier = "core";
  else if (roles.isDomainLead) tier = "domain-lead";
  else if (roles.isLabMember) tier = "member";
  else tier = "non-member";

  return {
    id: user.id,
    daliEmail: user.daliEmail,
    netId: user.netId,
    firstName: user.firstName,
    lastName: user.lastName,
    tier,
  };
}
