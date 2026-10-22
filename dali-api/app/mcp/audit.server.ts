import { logAuditEvent } from "~/lib/audit";

// Most specific entity first: a task call carries both taskId and projectId,
// and the task is the target, the project only its scope.
export const MCP_TARGET_KEYS = [
  "id",
  "taskId",
  "storyId",
  "epicId",
  "pageId",
  "meetingId",
  "applicationId",
  "submissionId",
  "assignmentId",
  "sessionId",
  "offeringId",
  "formId",
  "commentId",
  "messageId",
  "conversationId",
  "threadId",
  "fileId",
  "versionId",
  "shareId",
  "invoiceId",
  "certificateId",
  "postId",
  "requestId",
  "tagId",
  "templateId",
  "userId",
  "memberId",
  "netId",
  "orgId",
  "partnerOrgId",
  "contactId",
  "cycleId",
  "termId",
  "domainId",
  "projectId",
] as const;

export function mcpToolAction(scope: string): "mcp.tool_read" | "mcp.tool_called" {
  return scope === "mcp:read" ? "mcp.tool_read" : "mcp.tool_called";
}

export function mcpTargetId(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  for (const key of MCP_TARGET_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

export function mcpArgKeys(args: Record<string, unknown> | undefined): string[] {
  return args ? Object.keys(args).sort() : [];
}

export type McpToolCallAuth = {
  user: { id: string };
  clientId: string;
  clientName: string;
  grantId: string;
};

export type McpToolCallInput = {
  auth: McpToolCallAuth;
  toolName: string;
  scope: string;
  args?: Record<string, unknown>;
  errorCode?: number;
  request: Request;
};

export function buildMcpToolCallEvent({
  auth,
  toolName,
  scope,
  args,
  errorCode,
}: Omit<McpToolCallInput, "request">) {
  return {
    action: mcpToolAction(scope),
    userId: auth.user.id,
    targetId: mcpTargetId(args),
    metadata: {
      toolName,
      clientId: auth.clientId,
      clientName: auth.clientName,
      grantId: auth.grantId,
      argKeys: mcpArgKeys(args),
      outcome: errorCode === undefined ? "ok" : "error",
      ...(errorCode === undefined ? {} : { errorCode }),
    },
  };
}

export async function logMcpToolCall(input: McpToolCallInput): Promise<void> {
  const { request, ...rest } = input;
  await logAuditEvent({ ...buildMcpToolCallEvent(rest), request });
}
