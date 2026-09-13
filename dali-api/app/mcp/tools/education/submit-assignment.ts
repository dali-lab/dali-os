// MCP tool: submit_assignment — student self-submit for ALL submission modes.
// Modes supported: Text, File, Mixed, Link, Complete, Doc.
//   - Text: supply textContent
//   - File: supply pre-uploaded S3 files array (key + name)
//   - Mixed: textContent and/or files
//   - Link: supply link (http(s) URL)
//   - Complete: no artifact — just records completion
//   - Doc: collab-body mode — the body lives in the collab room; submitting sets
//         submittedAt. The caller must have already written content to the room
//         via the collab pipeline (set_page_content / Hocuspocus). We can't do
//         that server-side here without the collab-write step, so this tool
//         records the submission timestamp; the content is already in the room.
// Gate: student self (caller must be an Approved enrollee).
// Scope: mcp:write.

import { prisma } from "~/lib/db";
import { submitAssignment } from "~/education/lib/assignments.server";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const SUBMIT_ASSIGNMENT_TOOL = {
  name: "submit_assignment",
  description:
    "Submit or resubmit an assignment. You must be an Approved enrollee. Supported modes: Text (textContent), File (pre-uploaded files), Mixed (textContent + files), Link (http(s) URL), Complete (no artifact — marks done), Doc (collab-body — write content to the room first, then call this to set submittedAt).",
  inputSchema: {
    type: "object" as const,
    properties: {
      assignmentId: { type: "string", minLength: 1 },
      offeringId: { type: "string", minLength: 1 },
      textContent: {
        type: "string",
        description: "Text answer (Text and Mixed modes).",
      },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            name: { type: "string" },
          },
          required: ["key", "name"],
          additionalProperties: false,
        },
        description: "Pre-uploaded S3 file references (File and Mixed modes).",
      },
      link: {
        type: "string",
        description: "Deliverable URL (Link mode — must be http(s)).",
      },
    },
    required: ["assignmentId", "offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = {
  assignmentId: string;
  offeringId: string;
  textContent?: string;
  files?: { key: string; name: string }[];
  link?: string;
};

export async function runSubmitAssignment(ctx: McpCtx, args: Args) {
  // Caller must be an Approved enrollee for this offering.
  const application = await prisma.educationApplication.findFirst({
    where: {
      offeringId: args.offeringId,
      applicantUserId: ctx.user.id,
      status: "Approved",
    },
    select: { id: true },
  });
  if (!application) {
    throw new McpForbiddenError("You must be an approved enrollee to submit");
  }

  const result = await submitAssignment({
    assignmentId: args.assignmentId,
    offeringId: args.offeringId,
    studentId: ctx.user.id,
    applicationId: application.id,
    textContent: args.textContent ?? "",
    files: args.files ?? [],
    link: args.link,
  });

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true };
}

export const SUBMIT_ASSIGNMENT: McpTool = {
  def: SUBMIT_ASSIGNMENT_TOOL,
  run: (ctx: McpCtx, args) => runSubmitAssignment(ctx, args as Args),
};
