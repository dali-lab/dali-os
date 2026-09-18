// MCP `list_waitlist` — active waitlisted applicants across cycles.
// Access: Core only (mirrors the api.waitlist.ts loader).
// Optionally scoped to a single cycle via `cycleId`.

import { getUserRoles } from "~/lib/roles";
import { listActiveWaitlistEntries } from "~/hiring/lib/waitlist.server";
import { McpForbiddenError } from "../../registry";

export const LIST_WAITLIST_TOOL = {
  name: "list_waitlist",
  description:
    "List active waitlisted applicants. Returns entries from all cycles unless filtered by cycleId. Core only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cycleId: {
        type: "string",
        description:
          "Optional cycle filter. If omitted, returns waitlist entries across all cycles.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { cycleId?: string };

export async function runListWaitlist(userId: string, input: Input): Promise<unknown> {
  const roles = await getUserRoles(userId);
  if (!roles.isCore) {
    throw new McpForbiddenError("Core access required to view the waitlist");
  }

  const entries = await listActiveWaitlistEntries({ cycleId: input.cycleId });
  // Core-cycle waitlisters are current lab members — Admin-only (mirrors the
  // waitlists.tsx loader). Hide them from non-admin Core members.
  return roles.isAdmin
    ? entries
    : entries.filter((e) => e.cycle.cycleType !== "Core");
}
