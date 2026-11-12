// MCP tool errors + the faceting helper. This is a LEAF module — it imports
// nothing from the registry, so tool files can import it freely without the
// registry → area-index → tool → registry cycle. registry.ts re-exports these
// for back-compat (tools may import them from "../../registry" too).
//
// The dispatcher's mapToolError() keys off a numeric `.status`, so anything
// thrown with a `.status` maps to the right JSON-RPC code — the classes below
// are the canonical way to set it.

import { HttpError } from "~/lib/http-error";

export class McpError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message);
    this.name = "McpError";
  }
}

export class McpNotFoundError extends McpError {
  constructor(message = "Not found") {
    super(message, 404);
    this.name = "McpNotFoundError";
  }
}

export class McpForbiddenError extends McpError {
  constructor(message = "Forbidden") {
    super(message, 403);
    this.name = "McpForbiddenError";
  }
}

export class McpInvalidError extends McpError {
  constructor(message = "Invalid params") {
    super(message, 400);
    this.name = "McpInvalidError";
  }
}

/** Enforce per-action required fields for a faceted `manage_*` tool. The input
 *  validator is flat JSON Schema (no if/then), so faceted tools call this in
 *  run() to require fields conditionally on the chosen action. Presence-only. */
export function requireForAction(
  action: string,
  args: Record<string, unknown>,
  spec: Record<string, string[]>,
): void {
  const required = spec[action];
  if (!required) {
    throw new McpInvalidError(
      `Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`,
    );
  }
  const missing = required.filter((k) => args[k] === undefined || args[k] === null);
  if (missing.length) {
    throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
}

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
