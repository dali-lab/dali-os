import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  createOrPromoteMember,
  MemberInputError,
  PROFILE_TEXT_FIELDS,
  type CreateMemberInput,
} from "~/members/lib/membership.server";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminInvalidError as McpInvalidError,
} from "./errors";
import type { McpCtx } from "../../registry";

export const CREATE_MEMBER_TOOL = {
  name: "create_member",
  description:
    "Create a lab member, or promote the existing User to a member when the email already exists. " +
    "The email is routed by suffix: @dali.dartmouth.edu to daliEmail, @dartmouth.edu to dartmouthEmail, " +
    "anything else to personalEmail. Sends no email or notification. Intended for admin backfill. " +
    "Core members only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      firstName: { type: "string", minLength: 1 },
      lastName: { type: "string", minLength: 1 },
      email: { type: "string", minLength: 1, description: "Primary email, routed to a column by suffix." },
      dartmouthEmail: {
        type: "string",
        description: "Optional @dartmouth.edu alias so the member's Dartmouth login resolves to this account.",
      },
      classYear: { type: "integer", minimum: 1900, maximum: 2100 },
      ...Object.fromEntries(PROFILE_TEXT_FIELDS.map((f) => [f, { type: "string" }])),
    },
    required: ["firstName", "lastName", "email"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runCreateMember(ctx: McpCtx, args: CreateMemberInput) {
  const callerId = ctx.user.id;

  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can create members.");
  }

  let result: { id: string; created: boolean };
  try {
    result = await createOrPromoteMember(args, callerId);
  } catch (err) {
    if (err instanceof MemberInputError) throw new McpInvalidError(err.message);
    throw err;
  }

  await logAuditEvent({
    action: "member.create",
    userId: callerId,
    targetId: result.id,
    metadata: { created: result.created, email: args.email },
    request: ctx.request,
  });

  return result;
}
