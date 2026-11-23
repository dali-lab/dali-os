import { runOfferingAction } from "~/education/lib/offerings.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { setFormBinding } from "~/education/lib/feedback.server";
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
    "Create, update, publish or archive, duplicate or delete an education offering, or bind its feedback forms. Actions: create (Core only) · update (instructor/Core) · set_status (instructor/Core) · delete (Core, Draft only) · duplicate (Core only) · set_form_binding (instructor/Core). Instructors are managed with manage_offering_instructors; decision-email copy with manage_email_template.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "create",
          "update",
          "set_status",
          "delete",
          "duplicate",
          "set_form_binding",
        ],
      },
      offeringId: {
        type: "string",
        description: "Required for all actions except create.",
      },
      type: {
        type: "string",
        enum: ["Miniseries", "Fellowship", "Workshop"],
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
      firstSessionDate: {
        type: "string",
        description:
          "duplicate: ISO datetime of the first session in the new run. All other sessions and registration dates are shifted by the same delta. Omit to copy dates as-is.",
      },
      slot: {
        type: "string",
        description:
          "set_form_binding: feedback slot to bind ('session-feedback' or 'instructor-exit').",
      },
      formId: {
        type: "string",
        description:
          "set_form_binding: ID of the published form to bind. Omit or null to unbind.",
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
  firstSessionDate?: string;
  slot?: string;
  formId?: string | null;
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
    delete: ["offeringId"],
    duplicate: ["offeringId"],
    set_form_binding: ["offeringId", "slot"],
  });

  if (
    args.action === "update" ||
    args.action === "set_status" ||
    args.action === "set_form_binding"
  ) {
    if (!(await isOfferingManager(ctx.user.id, args.offeringId!))) {
      throw new McpForbiddenError();
    }
  } else if (
    args.action === "delete" ||
    args.action === "duplicate"
  ) {
    if (!(await isCore(ctx.user.id))) {
      throw new McpForbiddenError("Core only");
    }
  }
  // create: runOfferingAction re-checks isCore internally.

  if (args.action === "set_form_binding") {
    const result = await setFormBinding({
      offeringId: args.offeringId!,
      slot: args.slot!,
      formId: args.formId ?? null,
      actorId: ctx.user.id,
    });
    if ("error" in result) {
      if (result.status === 404) throw new McpNotFoundError(result.error);
      throw new McpInvalidError(result.error);
    }
    return { ok: true, id: args.offeringId ?? null };
  }

  const intentMap: Record<string, string> = {
    create: "create-offering",
    update: "update-offering",
    set_status: "set-status",
    delete: "delete-offering",
    duplicate: "duplicate-offering",
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
  if (args.firstSessionDate) fd.set("firstSessionDate", args.firstSessionDate);

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
