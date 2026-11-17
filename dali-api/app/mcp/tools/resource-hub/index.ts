// MCP tool area: Resource Hub. Aggregated into app/mcp/registry.ts.

import type { McpTool } from "../../registry";
import {
  GET_RESOURCE_HUB_TOOL,
  LIST_CRIT_POSTS_TOOL,
  LIST_DOMAIN_REFERENCES_TOOL,
  LIST_RESOURCE_HUBS_TOOL,
  MANAGE_DOMAIN_REFERENCE_TOOL,
  runGetResourceHub,
  runListCritPosts,
  runListDomainReferences,
  runListResourceHubs,
  runManageDomainReference,
} from "./hubs";

export const RESOURCE_HUB_TOOLS: McpTool[] = [
  { def: LIST_RESOURCE_HUBS_TOOL, featureFlag: "resource-hub", run: (ctx) => runListResourceHubs(ctx) },
  {
    def: GET_RESOURCE_HUB_TOOL,
    featureFlag: "resource-hub",
    run: (ctx, args) => runGetResourceHub(ctx, args as Parameters<typeof runGetResourceHub>[1]),
  },
  {
    def: LIST_CRIT_POSTS_TOOL,
    featureFlag: "resource-hub",
    run: (ctx, args) => runListCritPosts(ctx, args as Parameters<typeof runListCritPosts>[1]),
  },
  {
    def: LIST_DOMAIN_REFERENCES_TOOL,
    featureFlag: "resource-hub",
    run: (ctx, args) => runListDomainReferences(ctx, args as Parameters<typeof runListDomainReferences>[1]),
  },
  {
    def: MANAGE_DOMAIN_REFERENCE_TOOL,
    featureFlag: "resource-hub",
    run: (ctx, args) => runManageDomainReference(ctx, args as Parameters<typeof runManageDomainReference>[1]),
  },
];
