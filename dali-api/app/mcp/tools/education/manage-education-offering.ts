// MCP tool: manage_education_offering — create, update, set status, set
// instructors, or delete an education offering. All mutations go through
// runOfferingAction, which is the same FormData dispatcher the HTTP routes
// use, keeping validation/business logic in one place.
//
// Access tiers match the HTTP routes:
//   create / set_instructors / delete  → Core only (re-checked inside runOfferingAction)
//   update / set_status                → instructor or Core (isOfferingManager)

import { runOfferingAction } from "~/education/lib/offerings.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { isCore } from "~/lib/roles";
import {
  requireForAction,
  McpNotFoundError,
  McpForbiddenError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const MANAGE_EDUCATION_OFFERING_TOOL = {
  name: "manage_education_offering",
  description:
    "Create, update, set status, set instructors, or delete an education offering. Actions: create (Core only) · update (instructor/Core) · set_status (instructor/Core) · set_instructors (Core only) · delete (Core, Draft only).",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "set_status", "set_instructors", "delete"],
      },
      offeringId: {
        type: "string",
        description: "Required for all actions except create.",
      },
      type: {
        type: "string",
        enum: ["Miniseries", "Workshop"],
        description: "Offering type (create only).",
      },
      title: { type: "string", description: "Offering title." },
      capacity: { type: "number", description: "Max approved enrollments." },
      registrationOpensAt: { type: "string", description: "ISO datetime." },
      registrationClosesAt: { type: "string", description: "ISO datetime." },
      startsAt: { type: "string", description: "ISO datetime." },
      endsAt: { type: "string", description: "ISO datetime." },
      requiresReview: {
        type: "boolean",
        description: "If false, RSVP auto-approve mode.",
      },
      calendarEmail: {
        type: "string",
        description: "Optional calendar invite email.",
      },
      status: {
        type: "string",
        enum: ["Draft", "Published", "Archived"],
        description: "For set_status.",
      },
      userIds: {
        type: "array",
        items: { type: "string" },
        description: "For set_instructors: list of user IDs to assign as instructors.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = {
  action: string;
  offeringId?: string;
  type?: string;
  title?: string;
  capacity?: number;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  startsAt?: string;
  endsAt?: string;
  requiresReview?: boolean;
  calendarEmail?: string;
  status?: string;
  userIds?: string[];
};

export async function runManageEducationOffering(ctx: McpCtx, args: Args) {
  requireForAction(args.action, args, {
    create: [
      "type",
      "title",
      "capacity",
      "registrationOpensAt",
      "registrationClosesAt",
      "startsAt",
      "endsAt",
    ],
    update: [
      "offeringId",
      "title",
      "capacity",
      "registrationOpensAt",
      "registrationClosesAt",
      "startsAt",
      "endsAt",
    ],
    set_status: ["offeringId", "status"],
    set_instructors: ["offeringId", "userIds"],
    delete: ["offeringId"],
  });

  // Per-action access gate before touching the DB.
  if (args.action === "update" || args.action === "set_status") {
    if (!(await isOfferingManager(ctx.user.id, args.offeringId!))) {
      throw new McpForbiddenError();
    }
  } else if (
    args.action === "set_instructors" ||
    args.action === "delete"
  ) {
    if (!(await isCore(ctx.user.id))) {
      throw new McpForbiddenError("Core only");
    }
  }
  // create: runOfferingAction re-checks isCore internally.

  // Map action to the intent string runOfferingAction dispatches on.
  const intentMap: Record<string, string> = {
    create: "create-offering",
    update: "update-offering",
    set_status: "set-status",
    set_instructors: "set-instructors",
    delete: "delete-offering",
  };
  const intent = intentMap[args.action];

  const fd = new FormData();
  fd.set("intent", intent);

  if (args.offeringId) fd.set("offeringId", args.offeringId);
  if (args.type) fd.set("type", args.type);
  if (args.title !== undefined) fd.set("title", args.title);
  if (args.capacity !== undefined) fd.set("capacity", String(args.capacity));
  if (args.registrationOpensAt) fd.set("registrationOpensAt", args.registrationOpensAt);
  if (args.registrationClosesAt) fd.set("registrationClosesAt", args.registrationClosesAt);
  if (args.startsAt) fd.set("startsAt", args.startsAt);
  if (args.endsAt) fd.set("endsAt", args.endsAt);
  if (args.requiresReview !== undefined) {
    fd.set("requiresReview", args.requiresReview ? "true" : "false");
  }
  if (args.calendarEmail !== undefined) {
    fd.set("calendarEmail", args.calendarEmail);
  }
  if (args.status) fd.set("status", args.status);
  if (args.userIds) {
    for (const id of args.userIds) {
      fd.append("userIds", id);
    }
  }

  const result = await runOfferingAction(fd, ctx.user.id);

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true, id: result.id ?? args.offeringId ?? null };
}

export const MANAGE_EDUCATION_OFFERING: McpTool = {
  def: MANAGE_EDUCATION_OFFERING_TOOL,
  run: (ctx: McpCtx, args) => runManageEducationOffering(ctx, args as Args),
};
