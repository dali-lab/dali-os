// MCP `manage_manual_block` — faceted router over add/update/delete.
// Thin router only: all business logic (including the confirmed gate for work
// blocks) lives in the underlying run* functions.

import type { McpTool, McpCtx } from "../../registry";
import { McpInvalidError, requireForAction } from "../../errors";
import {
  ADD_MANUAL_BLOCK_TOOL,
  UPDATE_MANUAL_BLOCK_TOOL,
  DELETE_MANUAL_BLOCK_TOOL,
  runAddManualBlock,
  runUpdateManualBlock,
  runDeleteManualBlock,
} from "../manual-blocks";

// WORK_PROPERTIES in manual-blocks uses `as const` readonly enums; cast via
// unknown so the readonly tuple is assignable to JsonSchema.enum (unknown[]).
const MANAGE_MANUAL_BLOCK_DEF = {
  name: "manage_manual_block",
  description: `Manage the authenticated member's manual calendar blocks. Pass \`action\` to select the operation:
- \`add\`: add a manual calendar block. Requires: title, startTime, endTime. Set isWork to also log time; confirm with the user first.
- \`update\`: change a block's title, times, recurrence, or work attribution. Requires: id.
- \`delete\`: delete a manual block; its logged time entry (if work) goes with it. Requires: id.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["add", "update", "delete"],
        description: "Operation to perform.",
      },
      ...(ADD_MANUAL_BLOCK_TOOL.inputSchema.properties as unknown as Record<string, unknown>),
      ...(UPDATE_MANUAL_BLOCK_TOOL.inputSchema.properties as unknown as Record<string, unknown>),
      ...(DELETE_MANUAL_BLOCK_TOOL.inputSchema.properties as unknown as Record<string, unknown>),
    } as Record<string, unknown>,
    required: ["action"],
    additionalProperties: false,
  } as const as unknown as import("~/lib/mcp-input").JsonSchema,
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  add: ADD_MANUAL_BLOCK_TOOL.inputSchema.required,
  update: UPDATE_MANUAL_BLOCK_TOOL.inputSchema.required,
  delete: DELETE_MANUAL_BLOCK_TOOL.inputSchema.required,
};

async function run(ctx: McpCtx, args: Record<string, unknown>) {
  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);

  const { action: _action, ...rest } = args;

  switch (action) {
    case "add":
      return runAddManualBlock(ctx.user.id, rest as any);
    case "update":
      return runUpdateManualBlock(ctx.user.id, rest as any);
    case "delete":
      return runDeleteManualBlock(ctx.user.id, rest as any);
    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const MANAGE_MANUAL_BLOCK_TOOL: McpTool = { def: MANAGE_MANUAL_BLOCK_DEF, run };
