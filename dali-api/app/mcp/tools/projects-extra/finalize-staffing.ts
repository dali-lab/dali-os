// MCP `finalize_staffing` — confirm assignments + provision Slack/GitHub/Gmail
// for one project in a staffing cycle.
//
// This is a HIGH-BLAST operation: it confirms Proposed→Confirmed rows, fires
// notifications to members, and provisions real external resources (Slack
// channels, GitHub teams, Google Groups). Each automation step reports its own
// outcome so partial failures are visible.
//
// Wraps the extracted `finalizeStaffing()` server fn which shares identical
// business logic with the web route POST /api/staffing/finalize.
//
// Gate: mcp:admin, canManageStaffing.

import { canManageStaffing } from "~/lib/roles";
import { McpForbiddenError, McpInvalidError } from "./errors";
import { finalizeStaffing } from "~/projects/lib/finalize-staffing.server";

export const FINALIZE_STAFFING_TOOL = {
  name: "finalize_staffing",
  description:
    "HIGH-BLAST: Confirm proposed staffing assignments for one project and optionally provision their Slack channel, GitHub team, Google Group, and Vaultwarden group. Each automation step reports its own outcome. Idempotent — safe to re-run. Staffing managers only (mcp:admin). automations: any subset of ['assignments','slack','gmail','github','vaultwarden']. Pass saveFieldsOnly: true to persist channel/slug/collection fields without running any automations.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cycleId: { type: "string", minLength: 1, description: "StaffingCycle.id." },
      projectId: { type: "string", minLength: 1, description: "Project.id to finalize." },
      automations: {
        type: "array",
        items: {
          type: "string",
          enum: ["assignments", "slack", "gmail", "github", "vaultwarden"],
        },
        description: "Subset of automations to run.",
      },
      slackChannel: {
        type: "string",
        description: "Optional Slack channel name override. Persisted and used if provided.",
      },
      githubTeamSlug: {
        type: "string",
        description: "Optional GitHub team slug override. Persisted and used if provided.",
      },
      vaultwardenCollectionId: {
        type: "string",
        description:
          "Optional Vaultwarden collection id the project's group is granted access to. Persisted and used if provided.",
      },
      saveFieldsOnly: {
        type: "boolean",
        description:
          "When true, persist slackChannel/githubTeamSlug/vaultwardenCollectionId without running automations.",
      },
      promoteMentors: {
        type: "boolean",
        description: "When true, promote override-mentors below P3 to P3 during assignments step.",
      },
    },
    required: ["cycleId", "projectId", "automations"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type FinalizeStaffingInput = {
  cycleId: string;
  projectId: string;
  automations: string[];
  slackChannel?: string;
  githubTeamSlug?: string;
  vaultwardenCollectionId?: string;
  saveFieldsOnly?: boolean;
  promoteMentors?: boolean;
};

export async function runFinalizeStaffing(
  callerId: string,
  input: FinalizeStaffingInput,
): Promise<unknown> {
  if (!(await canManageStaffing(callerId))) {
    throw new McpForbiddenError("Only staffing managers can run finalize.");
  }

  if (!input.saveFieldsOnly && input.automations.length === 0) {
    throw new McpInvalidError("No automations selected.");
  }

  // Synthesize a minimal Request for logAuditEvent — the MCP path has no real
  // HTTP request, so we provide a stand-in that satisfies the shape audit needs.
  const syntheticRequest = new Request("https://dali-api.internal/mcp/finalize_staffing", {
    method: "POST",
  });

  return finalizeStaffing(callerId, input, syntheticRequest);
}
