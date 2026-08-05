// MCP tool: get_education_offering — full detail for a single education
// offering: sessions, instructors, registration window, capacity, approved
// count. Managers also see application counts. Scope: mcp:read.

import { getOfferingDetail } from "~/education/lib/offerings.server";
import { isOfferingManager } from "~/education/lib/access.server";
import type { McpCtx, McpTool } from "../../registry";
import { McpNotFoundError } from "../../registry";

export const GET_EDUCATION_OFFERING_TOOL = {
  name: "get_education_offering",
  description:
    "Get full detail for a single education offering: sessions, instructors, registration window, capacity, approved count. Managers also see application counts.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
    },
    required: ["offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { offeringId: string };

export async function runGetEducationOffering(ctx: McpCtx, input: Input) {
  const offering = await getOfferingDetail(input.offeringId);
  if (!offering) throw new McpNotFoundError("Offering not found");

  const manager = await isOfferingManager(ctx.user.id, input.offeringId);

  // Non-managers only see published offerings.
  if (offering.status !== "Published" && !manager) {
    throw new McpNotFoundError("Offering not found");
  }

  return {
    ...offering,
    registrationOpensAt: offering.registrationOpensAt.toISOString(),
    registrationClosesAt: offering.registrationClosesAt.toISOString(),
    startsAt: offering.startsAt.toISOString(),
    endsAt: offering.endsAt.toISOString(),
    closedOutAt: offering.closedOutAt?.toISOString() ?? null,
    sessions: offering.sessions.map((s) => ({
      ...s,
      datetime: s.datetime instanceof Date ? s.datetime.toISOString() : s.datetime,
    })),
  };
}

export const GET_EDUCATION_OFFERING: McpTool = {
  def: GET_EDUCATION_OFFERING_TOOL,
  run: (ctx: McpCtx, args) =>
    runGetEducationOffering(ctx, args as Input),
};
