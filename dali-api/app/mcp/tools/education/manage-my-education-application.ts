import { submitApplication } from "~/education/lib/apply.server";
import { withdrawApplication } from "~/education/lib/decisions.server";
import { requireForAction, McpNotFoundError, McpInvalidError } from "../../registry";
import type { McpCtx, McpTool } from "../../registry";

export const MANAGE_MY_EDUCATION_APPLICATION_TOOL = {
  name: "manage_my_education_application",
  description:
    "Apply to an education offering as yourself, or withdraw your own application. apply handles new applications, resubmissions while Submitted, and re-applies after withdrawal: RSVP offerings decide at once (Approved under capacity, Waitlisted past it), review offerings stay Submitted until an instructor decides. withdraw works for any open status, frees an Approved seat and promotes the next waitlisted applicant.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["apply", "withdraw"] },
      offeringId: { type: "string", minLength: 1 },
      answers: {
        type: "object",
        description:
          "Form answers keyed by question id (apply). Check get_education_offering for questions; pass {} when there are none.",
        additionalProperties: true,
      },
    },
    required: ["action", "offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { action: string; offeringId: string; answers?: Record<string, unknown> };

export async function runManageMyEducationApplication(ctx: McpCtx, args: Input) {
  requireForAction(args.action, args, { apply: ["offeringId"], withdraw: ["offeringId"] });

  if (args.action === "withdraw") {
    const result = await withdrawApplication({
      userId: ctx.user.id,
      offeringId: args.offeringId,
    });
    if ("error" in result) {
      if (result.status === 404) throw new McpNotFoundError(result.error);
      throw new McpInvalidError(result.error);
    }
    return { ok: true, promotedFromWaitlist: result.promotedApplicationId !== null };
  }

  const result = await submitApplication({
    offeringId: args.offeringId,
    userId: ctx.user.id,
    answers: args.answers ?? {},
  });
  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }
  return {
    status: result.status,
    message:
      result.status === "Approved"
        ? "You're enrolled!"
        : result.status === "Waitlisted"
          ? "You've been added to the waitlist."
          : "Application submitted for review.",
  };
}

export const MANAGE_MY_EDUCATION_APPLICATION: McpTool = {
  def: MANAGE_MY_EDUCATION_APPLICATION_TOOL,
  run: (ctx: McpCtx, args) => runManageMyEducationApplication(ctx, args as Input),
};
