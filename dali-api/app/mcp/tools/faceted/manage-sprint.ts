// MCP `manage_sprint` — faceted router over create/update/set_status/delete.
// Thin router only: all business logic lives in the underlying run* functions.

import type { McpTool, McpCtx } from "../../registry";
import { McpInvalidError, requireForAction } from "../../errors";
import { CREATE_SPRINT_TOOL, runCreateSprint } from "../create-sprint";
import { UPDATE_SPRINT_TOOL, runUpdateSprint } from "../update-sprint";
import { SET_SPRINT_STATUS_TOOL, runSetSprintStatus } from "../set-sprint-status";
import { DELETE_SPRINT_TOOL, runDeleteSprint } from "../delete-sprint";

const MANAGE_SPRINT_DEF = {
  name: "manage_sprint",
  description: `Manage project sprints. Pass \`action\` to select the operation:
- \`create\`: create a sprint. Requires: projectId, name, startsAt, endsAt.
- \`update\`: edit sprint fields (name, dates, epic link). Requires: sprintId.
- \`set_status\`: change lifecycle status (Planned/Active/Closed). Requires: sprintId, status.
- \`delete\`: delete a sprint; tasks fall back to backlog. Requires: sprintId.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "set_status", "delete"],
        description: "Operation to perform.",
      },
      // create fields
      ...CREATE_SPRINT_TOOL.inputSchema.properties,
      // update fields
      ...UPDATE_SPRINT_TOOL.inputSchema.properties,
      // set_status fields
      ...SET_SPRINT_STATUS_TOOL.inputSchema.properties,
      // delete fields
      ...DELETE_SPRINT_TOOL.inputSchema.properties,
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: CREATE_SPRINT_TOOL.inputSchema.required,
  update: UPDATE_SPRINT_TOOL.inputSchema.required,
  set_status: SET_SPRINT_STATUS_TOOL.inputSchema.required,
  delete: DELETE_SPRINT_TOOL.inputSchema.required,
};

async function run(ctx: McpCtx, args: Record<string, unknown>) {
  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);

  const { action: _action, ...rest } = args;

  switch (action) {
    case "create":
      return runCreateSprint(ctx.user.id, rest as any);
    case "update":
      return runUpdateSprint(ctx.user.id, rest as any);
    case "set_status":
      return runSetSprintStatus(ctx.user.id, rest as any);
    case "delete":
      return runDeleteSprint(ctx.user.id, rest as any);
    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const MANAGE_SPRINT_TOOL: McpTool = { def: MANAGE_SPRINT_DEF, run };
