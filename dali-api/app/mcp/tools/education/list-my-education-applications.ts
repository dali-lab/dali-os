// MCP tool: list_my_education_applications — all education applications the
// caller has submitted, across all offerings and all statuses including past
// ones. Scope: mcp:read.

import { listMyApplications } from "~/education/lib/offerings.server";
import type { McpCtx, McpTool } from "../../registry";

export const LIST_MY_EDUCATION_APPLICATIONS_TOOL = {
  name: "list_my_education_applications",
  description:
    "List all education applications you have submitted, across all offerings and all statuses including past ones.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListMyEducationApplications(ctx: McpCtx) {
  const apps = await listMyApplications(ctx.user.id);
  return {
    applications: apps.map((a) => ({
      ...a,
      submittedAt: a.submittedAt instanceof Date ? a.submittedAt.toISOString() : a.submittedAt,
      endsAt: a.endsAt instanceof Date ? a.endsAt.toISOString() : (a.endsAt ?? null),
      closedOutAt:
        a.closedOutAt instanceof Date
          ? a.closedOutAt.toISOString()
          : (a.closedOutAt ?? null),
    })),
  };
}

export const LIST_MY_EDUCATION_APPLICATIONS: McpTool = {
  def: LIST_MY_EDUCATION_APPLICATIONS_TOOL,
  run: (ctx: McpCtx, _args) => runListMyEducationApplications(ctx),
};
