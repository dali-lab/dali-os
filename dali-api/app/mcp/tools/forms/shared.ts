import { runFormsAction } from "~/forms/lib/forms-data";
import { canBuildForm } from "~/forms/lib/form-access.server";
import { McpForbiddenError, McpInvalidError, McpNotFoundError } from "../../registry";

export function unwrapFormResult<T extends object>(result: T | { error: string; status: number }): T {
  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }
  return result;
}

export async function requireFormEdit(userId: string, formId: string) {
  if (!(await canBuildForm(userId, formId))) {
    throw new McpForbiddenError("You do not have edit access to this form");
  }
}

export async function runFormIntent(userId: string, intent: string, fields: Record<string, string | undefined>) {
  const fd = new FormData();
  fd.set("intent", intent);
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) fd.set(key, value);
  }
  return unwrapFormResult(await runFormsAction(fd, userId));
}
