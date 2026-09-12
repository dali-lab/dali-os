// MCP tool: get_partner_sow — read the Statement of Work collab doc for a partner application.
// Scope: mcp:read. Gated to isCore.
//
// The SOW is a Hocuspocus collaborative document stored under the room name
// `partnersow:<applicationId>:body`. This tool reads the persisted CollabDocument
// state via readDocAsBlocks (collab/read.ts) — the same server-side read path used
// by exports and MCP read_page. Returns block JSON.
//
// COLLAB-BODY FLAG (read-only): write is not exposed here. The SOW lives in a live
// Hocuspocus room; writing a new state via direct DB update would bypass the CRDT
// pipeline and would not be broadcast to active sessions. SOW writes are intentionally
// web-only for now.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { readDocAsBlocks } from "~/collab/read";
import { McpForbiddenError, McpNotFoundError } from "../../registry";

export const GET_PARTNER_SOW_TOOL = {
  name: "get_partner_sow",
  description:
    "Read the Statement of Work collab document for a partner application. " +
    "Returns the doc as a blocks array (BlockNote JSON). If the SOW has never been edited, " +
    "returns an empty blocks array. Read-only — write is web-only. Requires Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      applicationId: {
        type: "string",
        description: "PartnerApplication id whose SOW to read.",
      },
    },
    required: ["applicationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runGetPartnerSow(
  callerId: string,
  input: { applicationId: string },
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can read partner SOW documents");
  }

  // Verify the application exists so we return 404 rather than an empty doc
  // for a totally unknown id.
  const app = await prisma.partnerApplication.findUnique({
    where: { id: input.applicationId },
    select: { id: true, title: true, sowDocId: true },
  });
  if (!app) {
    throw new McpNotFoundError(`Partner application ${input.applicationId} not found`);
  }

  const documentName = `partnersow:${input.applicationId}:body`;
  const blocks = await readDocAsBlocks(documentName);

  return {
    applicationId: input.applicationId,
    documentName,
    // sowDocId is a legacy reference field — the actual collab room is always
    // `partnersow:<id>:body` regardless of whether sowDocId is set.
    sowDocId: app.sowDocId ?? null,
    blocks,
    isEmpty: blocks.length === 0,
  };
}
