// MCP tool registry — the additive successor to the giant switch in
// app/routes/mcp.ts. New tools register here as self-describing entries; the
// route dispatches registry tools first and only falls through to the legacy
// switch for tools not yet migrated.
//
// A registry entry is fully self-contained: a tool def (name/description/schema/
// scope) plus a `run(ctx, args)` handler. Errors are mapped to JSON-RPC codes
// generically off a numeric `.status`, so an area module never needs to touch
// the route to add its own error class — throw an `McpError` (or anything with a
// `.status`) and the dispatcher does the rest.

import type { JsonSchema } from "~/lib/mcp-input";

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
  /** If set, this entry is a deprecated alias of another tool (kept callable,
   *  hidden from tools/list). Used when faceting renames an existing tool. */
  aliasOf?: string;
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
} from "./errors";

/** Map a thrown error to a JSON-RPC {code,message}. Reads a numeric `.status`
 *  (403→forbidden, 404→not found, else invalid-params); returns null when the
 *  error carries no status so the caller falls back to a generic -32000. */
export function mapToolError(err: unknown): { code: number; message: string } | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === "number") {
      const message = err instanceof Error ? err.message : String(err);
      const code = status === 403 ? -32003 : status === 404 ? -32004 : -32602;
      return { code, message };
    }
  }
  return null;
}

// ─── Registry ────────────────────────────────────────────────────────────────
// Area modules each export an McpTool[]; they're spread in here. The route reads
// REGISTRY_TOOLS for both tools/list and tools/call. Keep imports alphabetical.

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
import { MILESTONES_TOOLS } from "./tools/milestones";
import { FACETED_TOOLS } from "./tools/faceted";

export const REGISTRY_TOOLS: McpTool[] = [
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
  ...MILESTONES_TOOLS,
  ...FACETED_TOOLS,
];

const BY_NAME = new Map<string, McpTool>(REGISTRY_TOOLS.map((t) => [t.def.name, t]));

export function findRegistryTool(name: string): McpTool | undefined {
  return BY_NAME.get(name);
}

/** Tool defs advertised in tools/list — registry tools minus deprecated aliases. */
export function registryToolDefs(): McpToolDef[] {
  return REGISTRY_TOOLS.filter((t) => !t.aliasOf).map((t) => t.def);
}
