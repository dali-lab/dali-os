// MCP `get_delibs_session` — deliberation session board state (columns +
// candidates). Mirrors the GET logic of api.delibs.$id.ts.
//
// Access: hasCycleAccess + signed confidentiality agreement.
// This is a read-only tool; MCP never mutates delibs (no close action).

import { prisma } from "~/lib/db";
import { hasCycleAccess } from "~/lib/roles";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { McpNotFoundError, McpForbiddenError } from "../../registry";

export const GET_DELIBS_SESSION_TOOL = {
  name: "get_delibs_session",
  description:
    "Get a deliberation session's board state: columns with candidate domainApplicationIds, session type (Initial/Final), status, and domain. Requires cycle access and a signed confidentiality agreement.",
  inputSchema: {
    type: "object" as const,
    properties: {
      delibsSessionId: {
        type: "string",
        minLength: 1,
        description: "DelibsSession.id.",
      },
    },
    required: ["delibsSessionId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { delibsSessionId: string };

export async function runGetDelibsSession(userId: string, input: Input): Promise<unknown> {
  const session = await prisma.delibsSession.findUnique({
    where: { id: input.delibsSessionId },
    include: {
      domain: { select: { id: true, name: true, displayName: true } },
    },
  });

  if (!session) throw new McpNotFoundError("Deliberation session not found");

  if (!(await hasCycleAccess(userId, session.applicationCycleId))) {
    throw new McpForbiddenError("No access to this cycle");
  }

  const confState = await getCycleConfidentialityState(userId, session.applicationCycleId);
  if (confState.status !== "signed") {
    throw new McpForbiddenError(
      `Confidentiality agreement required (${confState.status}). Sign it in the web app first.`,
    );
  }

  return {
    id: session.id,
    cycleId: session.applicationCycleId,
    domainId: session.domainId,
    domain: session.domain
      ? {
          id: session.domain.id,
          name: session.domain.displayName ?? session.domain.name,
        }
      : null,
    type: session.type,
    status: session.status,
    columnOrder: session.columnOrder,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}
