// MCP resource `dali://me` — the caller's full profile + tier as JSON. Wraps
// `runGetMemberProfile` so a client can auto-attach the caller's identity to a
// conversation instead of forcing the model to call `whoami` first. Requires
// the `mcp:read` scope.

import { runGetMemberProfile } from "~/mcp/tools/get-member-profile";

export const ME_RESOURCE = {
  uri: "dali://me",
  name: "Me",
  description:
    "The authenticated DALI OS member's full profile, roles, and current-term domain eligibilities. JSON.",
  mimeType: "application/json",
  requiredScope: "mcp:read" as const,
};

export async function readMeResource(callerId: string) {
  const profile = await runGetMemberProfile(callerId, { memberId: callerId });
  return JSON.stringify(profile, null, 2);
}
