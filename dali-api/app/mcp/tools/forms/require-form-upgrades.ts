import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { McpForbiddenError, type McpCtx } from "../../registry";

export async function requireFormUpgrades(ctx: McpCtx) {
  const roles = await getUserRoles(ctx.user.id, ctx.request);
  if (!(await isFeatureEnabled("form-upgrades", ctx.user.id, roles, ctx.request))) {
    throw new McpForbiddenError("The form-upgrades feature flag is not enabled.");
  }
}
