// MCP tool registry — every tool app/routes/mcp.ts serves.
//
// A registry entry is fully self-contained: a tool def (name/description/schema/
// scope) plus a `run(ctx, args)` handler. Errors are mapped to JSON-RPC codes
// generically off a numeric `.status`, so an area module never needs to touch
// the route to add its own error class — throw an `McpError` (or anything with a
// `.status`) and the dispatcher does the rest.

import type { JsonSchema } from "~/lib/mcp-input";
import type { FeatureFlagKey } from "~/lib/feature-flags";

export type McpScope = "mcp:read" | "mcp:write" | "mcp:admin";

/** Authenticated caller + request context handed to every tool handler. */
export type McpCtx = {
  user: {
    id: string;
    daliEmail: string | null;
    dartmouthEmail: string | null;
    netId: string | null;
    firstName: string;
    lastName: string;
  };
  scopes: string[];
  request: Request;
};

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  requiredScope: McpScope;
};

export type McpTool = {
  def: McpToolDef;
  run: (ctx: McpCtx, args: Record<string, unknown>) => Promise<unknown>;
  featureFlag?: FeatureFlagKey;
};

// ─── Errors ──────────────────────────────────────────────────────────────────
// The error classes + requireForAction live in the leaf module ./errors (no
// registry import → no cycle for tool files). Re-exported here so a tool may
// import them from either "../../registry" or "../../errors".

export {
  McpError,
  McpNotFoundError,
  McpForbiddenError,
  McpInvalidError,
  requireForAction,
  mapToolError,
} from "./errors";

// ─── Registry ────────────────────────────────────────────────────────────────
// Area modules each export an McpTool[]; they're spread in here. The route reads
// REGISTRY_TOOLS for both tools/list and tools/call. Keep imports alphabetical.

import { BASE_TOOLS } from "./tools/base";
import { HIRING_TOOLS } from "./tools/hiring";
import { EDUCATION_TOOLS } from "./tools/education";
import { PARTNERS_TOOLS } from "./tools/partners";
import { DOCS_TOOLS } from "./tools/docs";
import { CALENDAR_TOOLS } from "./tools/calendar-extra";
import { MENTORSHIP_TOOLS } from "./tools/mentorship";
import { SIGNING_TOOLS } from "./tools/signing";
import { FORMS_TOOLS } from "./tools/forms";
import { ADMIN_TOOLS } from "./tools/admin";
import { PROJECTS_EXTRA_TOOLS } from "./tools/projects-extra";
import { FACETED_TOOLS } from "./tools/faceted";
import { PERSONAL_TOOLS } from "./tools/personal";
import { JOURNEYS_TOOLS } from "./tools/journeys";
import { COMMUNITY_TOOLS } from "./tools/community";
import { HELP_TOOLS } from "./tools/help";
import { CORE_MILESTONE_TOOLS } from "./tools/core-milestones";

export const REGISTRY_TOOLS: McpTool[] = [
  ...BASE_TOOLS,
  ...HIRING_TOOLS,
  ...EDUCATION_TOOLS,
  ...PARTNERS_TOOLS,
  ...DOCS_TOOLS,
  ...CALENDAR_TOOLS,
  ...MENTORSHIP_TOOLS,
  ...SIGNING_TOOLS,
  ...FORMS_TOOLS,
  ...ADMIN_TOOLS,
  ...PROJECTS_EXTRA_TOOLS,
  ...FACETED_TOOLS,
  ...PERSONAL_TOOLS,
  ...JOURNEYS_TOOLS,
  ...COMMUNITY_TOOLS,
  ...HELP_TOOLS,
  ...CORE_MILESTONE_TOOLS,
];

const BY_NAME = new Map<string, McpTool>(REGISTRY_TOOLS.map((t) => [t.def.name, t]));

export function findRegistryTool(name: string): McpTool | undefined {
  return BY_NAME.get(name);
}

export function registryToolDefs(): McpToolDef[] {
  return REGISTRY_TOOLS.map((t) => t.def);
}
