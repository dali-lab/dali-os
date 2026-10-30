import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { peopleByNetId } from "~/lib/dartmouth-people";
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

const EMAIL_FIELDS = ["email", "daliEmail", "dartmouthEmail", "personalEmail"] as const;
const IDENTITY_FIELDS = [...EMAIL_FIELDS, "netId"] as const;

export const CREATE_MEMBER_TOOL = {
  name: "create_member",
  description:
    "Create a lab member, or promote the existing User to a member when any given identity " +
    "(email or NetID) already belongs to one. An existing User only has blank fields filled; " +
    "values already set are never overwritten. The email is routed by suffix: @dali.dartmouth.edu to daliEmail, " +
    "@dartmouth.edu to dartmouthEmail, anything else to personalEmail; explicit identity fields override that routing. " +
    "With a NetID and no email, the email and class year come from the Dartmouth directory; a NetID " +
    "the directory doesn't know creates the member with no email. " +
    "Sends no email or notification. Intended for admin backfill. Core members only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      firstName: { type: "string", minLength: 1 },
      lastName: { type: "string", minLength: 1 },
      email: {
        type: "string",
        minLength: 1,
        description:
          "Primary email, routed to a column by suffix. At least one of email, daliEmail, dartmouthEmail, personalEmail is required unless netId is given.",
      },
      daliEmail: { type: "string", description: "An @dali.dartmouth.edu address." },
      dartmouthEmail: {
        type: "string",
        description: "An @dartmouth.edu address so the member's Dartmouth login resolves to this account.",
      },
      personalEmail: { type: "string" },
      netId: { type: "string" },
      githubUsername: { type: "string" },
      phoneNumber: { type: "string" },
      birthday: { type: "string", description: "YYYY-MM-DD" },
      dietaryRestrictions: { type: "string" },
      classYear: { type: "integer", minimum: 1900, maximum: 2100 },
      ...Object.fromEntries(PROFILE_TEXT_FIELDS.map((f) => [f, { type: "string" }])),
    },
    required: ["firstName", "lastName"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runCreateMember(ctx: McpCtx, args: CreateMemberInput) {
  const callerId = ctx.user.id;

  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can create members.");
  }

  let input = args;
  let allowMissingEmail = false;
  const netId = args.netId?.trim();
  if (netId && !EMAIL_FIELDS.some((f) => args[f]?.trim())) {
    let person: Awaited<ReturnType<typeof peopleByNetId>>;
    try {
      person = await peopleByNetId(netId.toLowerCase());
    } catch {
      throw new McpInvalidError(`Dartmouth directory lookup failed for ${netId}. Retry later.`);
    }
    input = {
      ...args,
      email: person?.email ?? undefined,
      classYear: args.classYear ?? person?.classYear ?? undefined,
    };
    allowMissingEmail = !person?.email;
  }

  let result: { id: string; created: boolean };
  try {
    result = await createOrPromoteMember(input, callerId, { allowMissingEmail });
  } catch (err) {
    if (err instanceof MemberInputError) throw new McpInvalidError(err.message);
    throw err;
  }

  await logAuditEvent({
    action: "member.create",
    userId: callerId,
    targetId: result.id,
    metadata: {
      created: result.created,
      email: args.email,
      identityFields: IDENTITY_FIELDS.filter((f) => args[f]?.trim()),
    },
    request: ctx.request,
  });

  return result;
}
