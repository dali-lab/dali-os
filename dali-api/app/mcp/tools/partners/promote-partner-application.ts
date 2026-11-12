// MCP tool: promote_partner_application. Scope: mcp:admin, gated to isCore.
// The promote logic lives in partners/lib/partner-promote.server.ts, shared with the web action.

import { isCore } from "~/lib/roles";
import { promotePartnerApplication } from "~/partners/lib/partner-promote.server";
import { McpForbiddenError } from "../../errors";

export const PROMOTE_PARTNER_APPLICATION_TOOL = {
  name: "promote_partner_application",
  description:
    "Promote a partner application to a Project. Seeds the project from the application's title, summary, target terms, and domain scope. Creates ProjectRoleRequest rows (level P1) for domains with expectedMembers > 0 in the first target term (the one the project is seeded with). A returning application (one that continues a past project) instead reopens that project: adds the target terms back, seeds spots where a term has none, marks those terms continuing, and returns reopened=true. Idempotent: if the application was already promoted, returns the existing projectId with alreadyExisted=true. Requires Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      applicationId: { type: "string", description: "PartnerApplication id to promote." },
      orgName: {
        type: "string",
        description:
          "Name for the PartnerOrg created at promotion. Only used when the application has no org yet (account-first). Defaults to the applicant's name as an individual partner.",
      },
    },
    required: ["applicationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runPromotePartnerApplication(
  callerId: string,
  input: { applicationId: string; orgName?: string },
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can promote partner applications");
  }
  return promotePartnerApplication({
    applicationId: input.applicationId,
    orgName: input.orgName,
    actorUserId: callerId,
  });
}
