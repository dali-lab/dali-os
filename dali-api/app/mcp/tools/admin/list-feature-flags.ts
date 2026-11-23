import { isCore } from "~/lib/roles";
import { listFlagsForAdmin } from "~/lib/feature-flags.server";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const LIST_FEATURE_FLAGS_TOOL = {
  name: "list_feature_flags",
  description:
    "List all feature flags with their current targeting and variant options. A flag is on for a user when it's enabled and any target matches: everyone, a listed role, or a named user. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListFeatureFlags(ctx: McpCtx) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can view feature flags.");
  }
  return { flags: await listFlagsForAdmin() };
}
