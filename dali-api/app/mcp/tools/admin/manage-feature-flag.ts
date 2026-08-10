// MCP `manage_feature_flag` — list or configure feature-flag targeting.
// Mirrors the Admin → Feature Flags panel and api.feature-flags.$key.ts route.
// Requires the `mcp:admin` scope; caller must be isCore.

import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  ROLE_TARGETS,
  isFeatureFlagKey,
  type RoleTarget,
} from "~/lib/feature-flags";
import { listFlagsForAdmin, updateFlag } from "~/lib/feature-flags.server";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminNotFoundError as McpNotFoundError,
  AdminInvalidError as McpInvalidError,
  requireForAction,
} from "./errors";
import type { McpCtx } from "../../registry";

export const MANAGE_FEATURE_FLAG_TOOL = {
  name: "manage_feature_flag",
  description:
    "List or configure feature flags (gradual rollout). A flag is on for a " +
    "user when it's enabled and any target matches: everyone, a listed role, " +
    "or a named user. Actions: list · set_config. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["list", "set_config"],
        description:
          "list — return all flags and their current targeting; set_config — patch one flag.",
      },
      key: {
        type: "string",
        description: "set_config: the flag's registry key (e.g. \"desktop-app\").",
      },
      enabled: {
        type: "boolean",
        description: "set_config: master switch. False turns the flag off for everyone.",
      },
      everyone: {
        type: "boolean",
        description: "set_config: when enabled, turn the flag on for all users.",
      },
      roles: {
        type: "array",
        items: { type: "string", enum: ROLE_TARGETS as unknown as string[] },
        description: `set_config: role targets. Any of: ${ROLE_TARGETS.join(", ")}.`,
      },
      userIds: {
        type: "array",
        items: { type: "string" },
        description: "set_config: explicit User.id allowlist.",
      },
      note: {
        type: "string",
        description: "set_config: optional operator note (empty string clears it).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = {
  action: string;
  key?: string;
  enabled?: boolean;
  everyone?: boolean;
  roles?: string[];
  userIds?: string[];
  note?: string;
};

export async function runManageFeatureFlag(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can manage feature flags.");
  }

  if (args.action === "list") {
    return { flags: await listFlagsForAdmin() };
  }

  requireForAction(args.action, args as Record<string, unknown>, {
    list: [],
    set_config: ["key"],
  });

  const key = args.key as string;
  if (!isFeatureFlagKey(key)) throw new McpNotFoundError(`Unknown feature flag: ${key}`);

  if (args.roles !== undefined) {
    const invalid = args.roles.filter(
      (r) => !(ROLE_TARGETS as readonly string[]).includes(r),
    );
    if (invalid.length) {
      throw new McpInvalidError(
        `Unknown role target(s): ${invalid.join(", ")}. Expected any of: ${ROLE_TARGETS.join(", ")}`,
      );
    }
  }

  if (
    args.enabled === undefined &&
    args.everyone === undefined &&
    args.roles === undefined &&
    args.userIds === undefined &&
    args.note === undefined
  ) {
    throw new McpInvalidError("Nothing to update");
  }

  // Partial patch: merge the provided fields onto the flag's current config so
  // a caller can flip one dimension without restating the rest.
  const current = (await listFlagsForAdmin()).find((f) => f.key === key)!;
  const patch = {
    enabled: args.enabled ?? current.enabled,
    everyone: args.everyone ?? current.everyone,
    roles: (args.roles ?? current.roles) as RoleTarget[],
    userIds: args.userIds ?? current.userIds,
    note: args.note !== undefined ? args.note || null : current.note,
  };
  await updateFlag(key, patch);

  await logAuditEvent({
    action: "feature-flags.update",
    userId: ctx.user.id,
    targetId: key,
    metadata: {
      enabled: patch.enabled,
      everyone: patch.everyone,
      roles: patch.roles,
      userCount: patch.userIds.length,
    },
    request: ctx.request,
  });

  return { ok: true };
}
