// MCP tool area: Resource Hub. Aggregated into app/mcp/registry.ts.

import type { McpTool } from "../../registry";
import {
  GET_RESOURCE_HUB_TOOL,
  LIST_RESOURCE_HUBS_TOOL,
  runGetResourceHub,
  runListResourceHubs,
} from "./hubs";

export const RESOURCE_HUB_TOOLS: McpTool[] = [
  { def: LIST_RESOURCE_HUBS_TOOL, featureFlag: "resource-hub", run: (ctx) => runListResourceHubs(ctx) },
  {
    def: GET_RESOURCE_HUB_TOOL,
    featureFlag: "resource-hub",
    run: (ctx, args) => runGetResourceHub(ctx, args as Parameters<typeof runGetResourceHub>[1]),
  },
];
