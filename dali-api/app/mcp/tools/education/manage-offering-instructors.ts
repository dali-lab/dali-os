import { runOfferingAction } from "~/education/lib/offerings.server";
import { isCore } from "~/lib/roles";
import {
  requireForAction,
  McpNotFoundError,
  McpForbiddenError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const MANAGE_OFFERING_INSTRUCTORS_TOOL = {
  name: "manage_offering_instructors",
  description:
    "Core only. Set an education offering's instructors, or invite or remove an external instructor. Actions: set · invite_external · remove_external. Inviting emails the instructor.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["set", "invite_external", "remove_external"],
      },
      offeringId: { type: "string", description: "The offering ID." },
      userIds: {
        type: "array",
        items: { type: "string" },
        description: "User IDs to assign as the instructors (set).",
      },
      netId: {
        type: "string",
        description: "Dartmouth NetID of the external instructor (invite_external).",
      },
      firstName: { type: "string", description: "First name (invite_external)." },
      lastName: { type: "string", description: "Last name (invite_external)." },
      userId: {
        type: "string",
        description: "User ID of the external instructor to remove (remove_external).",
      },
    },
    required: ["action", "offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = {
  action: string;
  offeringId: string;
  userIds?: string[];
  netId?: string;
  firstName?: string;
  lastName?: string;
  userId?: string;
};

const INTENT: Record<string, string> = {
  set: "set-instructors",
  invite_external: "invite-external-instructor",
  remove_external: "remove-external-instructor",
};

export async function runManageOfferingInstructors(ctx: McpCtx, args: Args) {
  requireForAction(args.action, args, {
    set: ["offeringId", "userIds"],
    invite_external: ["offeringId", "netId", "firstName", "lastName"],
    remove_external: ["offeringId", "userId"],
  });

  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }

  const fd = new FormData();
  fd.set("intent", INTENT[args.action]);
  fd.set("offeringId", args.offeringId);
  for (const id of args.userIds ?? []) fd.append("userIds", id);
  if (args.netId) fd.set("netId", args.netId);
  if (args.firstName) fd.set("firstName", args.firstName);
  if (args.lastName) fd.set("lastName", args.lastName);
  if (args.userId) fd.set("userId", args.userId);

  const result = await runOfferingAction(fd, ctx.user.id);
  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }
  return { ok: true, id: result.id ?? args.offeringId };
}

export const MANAGE_OFFERING_INSTRUCTORS: McpTool = {
  def: MANAGE_OFFERING_INSTRUCTORS_TOOL,
  run: (ctx: McpCtx, args) => runManageOfferingInstructors(ctx, args as Args),
};
