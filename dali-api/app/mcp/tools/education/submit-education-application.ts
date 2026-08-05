// MCP tool: submit_education_application — apply to a workshop or miniseries.
// Handles new applications, resubmissions, and re-applies after withdrawal.
// RSVP offerings auto-decide immediately; review-required offerings land as
// Submitted. Scope: mcp:write.

import { submitApplication } from "~/education/lib/apply.server";
import type { McpCtx, McpTool } from "../../registry";
import { McpNotFoundError, McpInvalidError } from "../../registry";

export const SUBMIT_EDUCATION_APPLICATION_TOOL = {
  name: "submit_education_application",
  description:
    "Apply to an education offering (workshop or miniseries). Handles new applications, resubmissions (while Submitted), and re-applies after withdrawal. RSVP offerings auto-decide immediately (Approved under capacity, Waitlisted past it); review-required offerings land as Submitted until an instructor decides.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
      answers: {
        type: "object",
        description:
          "Form answers keyed by question id. Use get_education_offering to check whether the offering has questions. Pass {} for offerings with no required fields.",
        additionalProperties: true,
      },
    },
    required: ["offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { offeringId: string; answers?: Record<string, unknown> };

export async function runSubmitEducationApplication(ctx: McpCtx, args: Input) {
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

export const SUBMIT_EDUCATION_APPLICATION: McpTool = {
  def: SUBMIT_EDUCATION_APPLICATION_TOOL,
  run: (ctx: McpCtx, args) =>
    runSubmitEducationApplication(ctx, args as Input),
};
