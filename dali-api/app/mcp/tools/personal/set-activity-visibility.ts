// MCP `set_activity_visibility` — toggle the caller's "hide activity" presence
// flag. Reuses the same Prisma call as api.presence.hide-activity.ts.
// Self-only. Requires `mcp:write`.

import { prisma } from "~/lib/db";

export const SET_ACTIVITY_VISIBILITY_DEF = {
  name: "set_activity_visibility",
  description:
    "Control whether your activity (online presence) is visible to other lab members. " +
    "Pass `hideActivity: true` to go invisible; `false` to show your status again.",
  inputSchema: {
    type: "object" as const,
    properties: {
      hideActivity: {
        type: "boolean",
        description: "True to hide your activity from others; false to show it.",
      },
    },
    required: ["hideActivity"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { hideActivity: boolean };

export async function runSetActivityVisibility(userId: string, input: Input) {
  await prisma.user.update({
    where: { id: userId },
    data: { hideActivity: input.hideActivity },
  });
  return { ok: true, hideActivity: input.hideActivity };
}
