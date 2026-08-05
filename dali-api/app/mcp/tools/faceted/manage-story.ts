// MCP `manage_story` — faceted router over create/update/delete.
// Thin router only: all business logic lives in the underlying run* functions.

import type { McpTool, McpCtx } from "../../registry";
import { McpInvalidError, requireForAction } from "../../errors";
import { CREATE_STORY_TOOL, runCreateStory } from "../create-story";
import { UPDATE_STORY_TOOL, runUpdateStory } from "../update-story";
import { DELETE_STORY_TOOL, runDeleteStory } from "../delete-story";

const MANAGE_STORY_DEF = {
  name: "manage_story",
  description: `Manage user stories under epics. Pass \`action\` to select the operation:
- \`create\`: create a user story. Requires: epicId, title.
- \`update\`: edit a story's title, notes, or status. Requires: storyId.
- \`delete\`: delete a user story. Requires: storyId.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete"],
        description: "Operation to perform.",
      },
      // create fields
      ...CREATE_STORY_TOOL.inputSchema.properties,
      // update fields
      ...UPDATE_STORY_TOOL.inputSchema.properties,
      // delete fields
      ...DELETE_STORY_TOOL.inputSchema.properties,
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: CREATE_STORY_TOOL.inputSchema.required,
  update: UPDATE_STORY_TOOL.inputSchema.required,
  delete: DELETE_STORY_TOOL.inputSchema.required,
};

async function run(ctx: McpCtx, args: Record<string, unknown>) {
  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);

  const { action: _action, ...rest } = args;

  switch (action) {
    case "create":
      return runCreateStory(ctx.user.id, rest as any);
    case "update":
      return runUpdateStory(ctx.user.id, rest as any);
    case "delete":
      return runDeleteStory(ctx.user.id, rest as any);
    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const MANAGE_STORY_TOOL: McpTool = { def: MANAGE_STORY_DEF, run };
