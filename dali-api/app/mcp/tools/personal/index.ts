// MCP tool area: personal. Aggregated into app/mcp/registry.ts.

import type { McpTool } from "../../registry";

import {
  LIST_MEMBERS_DEF,
  runListMembers,
} from "./list-members";

export const PERSONAL_TOOLS: McpTool[] = [
  {
    def: LIST_MEMBERS_DEF,
    run: (_ctx, args) =>
      runListMembers(args as Parameters<typeof runListMembers>[0]),
  },
];
