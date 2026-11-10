import { validateInput, type JsonSchema } from "~/lib/mcp-input";
import { logMcpToolCall, type McpToolOrigin } from "./audit.server";
import { findRegistryTool, mapToolError, type McpCtx } from "./registry";

export type ToolCaller = McpCtx & {
  origin: McpToolOrigin;
  clientId: string;
  clientName: string;
  grantId: string | null;
};

export type DispatchResult =
  | { ok: true; payload: unknown }
  | { ok: false; code: number; message: string };

export async function dispatchTool(
  name: string | undefined,
  rawArgs: unknown,
  caller: ToolCaller,
): Promise<DispatchResult> {
  const tool = name ? findRegistryTool(name) : undefined;
  if (!tool) return { ok: false, code: -32601, message: `Unknown tool: ${name}` };

  const { user, scopes, request, origin, clientId, clientName, grantId } = caller;
  const audit = {
    auth: { user, origin, clientId, clientName, grantId },
    toolName: tool.def.name,
    scope: tool.def.requiredScope,
    request,
  };
  if (!scopes.includes(tool.def.requiredScope)) {
    await logMcpToolCall({ ...audit, errorCode: -32002 });
    return { ok: false, code: -32002, message: `Missing required scope: ${tool.def.requiredScope}` };
  }
  const validated = validateInput(rawArgs, tool.def.inputSchema as JsonSchema);
  if (!validated.ok) {
    await logMcpToolCall({ ...audit, errorCode: -32602 });
    return { ok: false, code: -32602, message: `Invalid params: ${validated.error}` };
  }
  const args = validated.value as Record<string, unknown>;
  try {
    const payload = await tool.run({ user, scopes, request }, args);
    await logMcpToolCall({ ...audit, args });
    return { ok: true, payload };
  } catch (err) {
    const mapped = mapToolError(err);
    await logMcpToolCall({ ...audit, args, errorCode: mapped?.code ?? -32000 });
    if (mapped) return { ok: false, ...mapped };
    return {
      ok: false,
      code: -32000,
      message: err instanceof Error ? err.message : "Tool execution failed",
    };
  }
}
