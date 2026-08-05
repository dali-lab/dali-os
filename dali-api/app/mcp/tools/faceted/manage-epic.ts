// MCP `manage_epic` — faceted router over create/update/delete.
// Thin router only: all business logic lives in the underlying run* functions.

import type { McpTool, McpCtx } from "../../registry";
import { McpInvalidError, requireForAction } from "../../errors";
import { CREATE_EPIC_TOOL, runCreateEpic } from "../create-epic";
import { UPDATE_EPIC_TOOL, runUpdateEpic } from "../update-epic";
import { DELETE_EPIC_TOOL, runDeleteEpic } from "../delete-epic";

const MANAGE_EPIC_DEF = {
  name: "manage_epic",
  description: `Manage project epics. Pass \`action\` to select the operation:
- \`create\`: create an epic. Requires: projectId, title.
- \`update\`: edit an epic's fields (title, description, status, dates, target term). Requires: epicId.
- \`delete\`: delete an epic; sprints and tasks have their epicId nulled. Requires: epicId.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete"],
        description: "Operation to perform.",
      },
      // create fields
      ...CREATE_EPIC_TOOL.inputSchema.properties,
      // update fields
      ...UPDATE_EPIC_TOOL.inputSchema.properties,
      // delete fields
      ...DELETE_EPIC_TOOL.inputSchema.properties,
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: CREATE_EPIC_TOOL.inputSchema.required,
  update: UPDATE_EPIC_TOOL.inputSchema.required,
  delete: DELETE_EPIC_TOOL.inputSchema.required,
};

async function run(ctx: McpCtx, args: Record<string, unknown>) {
  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);

  const { action: _action, ...rest } = args;

  switch (action) {
    case "create":
      return runCreateEpic(ctx.user.id, rest as any);
    case "update":
      return runUpdateEpic(ctx.user.id, rest as any);
    case "delete":
      return runDeleteEpic(ctx.user.id, rest as any);
    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const MANAGE_EPIC_TOOL: McpTool = { def: MANAGE_EPIC_DEF, run };
