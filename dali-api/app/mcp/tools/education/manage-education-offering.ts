// MCP tool: manage_education_offering — create, update, set status, set
// instructors, duplicate, invite/remove external instructors, set form bindings,
// or configure decision emails. All mutations go through runOfferingAction or
// the appropriate lib server function, which is the same path the HTTP routes
// use, keeping validation/business logic in one place.
//
// Access tiers match the HTTP routes:
//   create / set_instructors / delete / duplicate / invite_external_instructor /
//   remove_external_instructor           → Core only
//   update / set_status / set_form_binding / set_decision_email
//                                        → instructor or Core (isOfferingManager)

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
    "Create, update, set status, set instructors, duplicate, invite/remove external instructors, bind feedback forms, or configure decision emails for an education offering. Actions: create (Core only) · update (instructor/Core) · set_status (instructor/Core) · set_instructors (Core only) · delete (Core, Draft only) · duplicate (Core only) · invite_external_instructor (Core only) · remove_external_instructor (Core only) · set_form_binding (instructor/Core) · set_decision_email (instructor/Core).",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "create",
          "update",
          "set_status",
          "set_instructors",
          "delete",
          "duplicate",
          "invite_external_instructor",
          "remove_external_instructor",
          "set_form_binding",
          "set_decision_email",
        ],
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
      firstSessionDate: {
        type: "string",
        description:
          "duplicate: ISO datetime of the first session in the new run. All other sessions and registration dates are shifted by the same delta. Omit to copy dates as-is.",
      },
      netId: {
        type: "string",
        description:
          "invite_external_instructor: Dartmouth NetID of the external instructor.",
      },
      firstName: {
        type: "string",
        description: "invite_external_instructor: first name.",
      },
      lastName: {
        type: "string",
        description: "invite_external_instructor: last name.",
      },
      userId: {
        type: "string",
        description:
          "remove_external_instructor: user ID of the external instructor to remove.",
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
      decisionStatus: {
        type: "string",
        enum: ["Approved", "Waitlisted", "Rejected"],
        description: "set_decision_email: which application status to configure.",
      },
      emailTemplateVersionId: {
        type: "string",
        description:
          "set_decision_email: email template version ID to send. Omit or empty to clear the binding.",
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
  firstSessionDate?: string;
  netId?: string;
  firstName?: string;
  lastName?: string;
  userId?: string;
  slot?: string;
  formId?: string | null;
  decisionStatus?: string;
  emailTemplateVersionId?: string;
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
    duplicate: ["offeringId"],
    invite_external_instructor: ["offeringId", "netId", "firstName", "lastName"],
    remove_external_instructor: ["offeringId", "userId"],
    set_form_binding: ["offeringId", "slot"],
    set_decision_email: ["offeringId", "decisionStatus"],
  });

  // Per-action access gate before touching the DB.
  if (
    args.action === "update" ||
    args.action === "set_status" ||
    args.action === "set_form_binding" ||
    args.action === "set_decision_email"
  ) {
    if (!(await isOfferingManager(ctx.user.id, args.offeringId!))) {
      throw new McpForbiddenError();
    }
  } else if (
    args.action === "set_instructors" ||
    args.action === "delete" ||
    args.action === "duplicate" ||
    args.action === "invite_external_instructor" ||
    args.action === "remove_external_instructor"
  ) {
    if (!(await isCore(ctx.user.id))) {
      throw new McpForbiddenError("Core only");
    }
  }
  // create: runOfferingAction re-checks isCore internally.

  // set_form_binding uses the feedback server fn directly (not runOfferingAction).
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

  // Map action to the intent string runOfferingAction dispatches on.
  const intentMap: Record<string, string> = {
    create: "create-offering",
    update: "update-offering",
    set_status: "set-status",
    set_instructors: "set-instructors",
    delete: "delete-offering",
    duplicate: "duplicate-offering",
    invite_external_instructor: "invite-external-instructor",
    remove_external_instructor: "remove-external-instructor",
    set_decision_email: "set-decision-email",
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
  // duplicate
  if (args.firstSessionDate) fd.set("firstSessionDate", args.firstSessionDate);
  // invite_external_instructor
  if (args.netId) fd.set("netId", args.netId);
  if (args.firstName) fd.set("firstName", args.firstName);
  if (args.lastName) fd.set("lastName", args.lastName);
  // remove_external_instructor
  if (args.userId) fd.set("userId", args.userId);
  // set_decision_email
  if (args.decisionStatus) fd.set("status", args.decisionStatus);
  if (args.emailTemplateVersionId !== undefined) {
    fd.set("emailTemplateVersionId", args.emailTemplateVersionId);
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
