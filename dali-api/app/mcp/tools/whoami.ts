import { getUserRoles } from "~/lib/roles";
import { runListMyRoles } from "./time-entries";

export const WHOAMI_TOOL = {
  name: "whoami",
  description:
    "Return the authenticated DALI OS member's identity and role tier. With includeRoles, also list their paid roles for the current term, each with the assignmentType and roleRefId needed to attribute a time entry. Call that before logging time.",
  inputSchema: {
    type: "object" as const,
    properties: {
      includeRoles: { type: "boolean", description: "Also return paid roles as roles. Default false." },
      allTerms: { type: "boolean", description: "includeRoles only: roles from every term, not just the current one. Default false." },
    },
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

export async function runWhoami(user: WhoamiUser, input: { includeRoles?: boolean; allTerms?: boolean } = {}) {
  const roles = await getUserRoles(user.id);
  // Coarse, externally-stable tier label.
  let tier: "admin" | "core" | "domain-lead" | "member" | "non-member";
  if (roles.isAdmin) tier = "admin";
  else if (roles.isCore) tier = "core";
  else if (roles.isDomainLead) tier = "domain-lead";
  else if (roles.isLabMemberOrAlum) tier = "member";
  else tier = "non-member";

  return {
    id: user.id,
    daliEmail: user.daliEmail,
    netId: user.netId,
    firstName: user.firstName,
    lastName: user.lastName,
    tier,
    ...(input.includeRoles ? await runListMyRoles(user.id, { allTerms: input.allTerms }) : {}),
  };
}
