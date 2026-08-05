// MCP `manage_time_entry` — faceted router over add/update/delete.
// Thin router only: all business logic (including the two-step confirmed gate)
// lives in the underlying run* functions. Args are passed through unchanged so
// the gate still works.

import type { McpTool, McpCtx } from "../../registry";
import { McpInvalidError, requireForAction } from "../../errors";
import {
  ADD_TIME_ENTRY_TOOL,
  UPDATE_TIME_ENTRY_TOOL,
  DELETE_TIME_ENTRY_TOOL,
  runAddTimeEntry,
  runUpdateTimeEntry,
  runDeleteTimeEntry,
} from "../time-entries";

const MANAGE_TIME_ENTRY_DEF = {
  name: "manage_time_entry",
  description: `Manage the authenticated member's manual time entries. Pass \`action\` to select the operation:
- \`add\`: log a manual time entry. Requires: date, hours, assignmentType, roleRefId. Two-step: call without \`confirmed\` first to see a preview, then re-call with \`confirmed: true\`.
- \`update\`: change an entry's date, hours, role, note, or time range. Requires: id. Same two-step confirmation as add.
- \`delete\`: delete a Manual time entry. Requires: id. No confirmation gate.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["add", "update", "delete"],
        description: "Operation to perform.",
      },
      // add fields
      ...ADD_TIME_ENTRY_TOOL.inputSchema.properties,
      // update fields
      ...UPDATE_TIME_ENTRY_TOOL.inputSchema.properties,
      // delete fields
      ...DELETE_TIME_ENTRY_TOOL.inputSchema.properties,
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  add: ADD_TIME_ENTRY_TOOL.inputSchema.required,
  update: UPDATE_TIME_ENTRY_TOOL.inputSchema.required,
  delete: DELETE_TIME_ENTRY_TOOL.inputSchema.required,
};

async function run(ctx: McpCtx, args: Record<string, unknown>) {
  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);

  const { action: _action, ...rest } = args;

  switch (action) {
    case "add":
      return runAddTimeEntry(ctx.user.id, rest as any);
    case "update":
      return runUpdateTimeEntry(ctx.user.id, rest as any);
    case "delete":
      return runDeleteTimeEntry(ctx.user.id, rest as any);
    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const MANAGE_TIME_ENTRY_TOOL: McpTool = { def: MANAGE_TIME_ENTRY_DEF, run };
