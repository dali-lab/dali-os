import { expenseAccessDenial } from "~/expenses/lib/access";
import { ExpenseError } from "~/expenses/lib/errors";
import { getUserRoles } from "~/lib/roles";
import { centsToDecimalString, parseMoneyToCents } from "~/expenses/lib/money";
import { loadExpenseViewer } from "~/expenses/lib/viewer.server";
import type { ExpenseViewer } from "~/expenses/lib/access";
import type { McpCtx } from "../../registry";
import { McpForbiddenError, McpInvalidError, McpNotFoundError } from "../../errors";

export const EXPENSES_FLAG = "expenses" as const;

export function toMcpError(err: unknown): unknown {
  if (!(err instanceof ExpenseError)) return err;
  if (err.status === 403) return new McpForbiddenError(err.message);
  if (err.status === 404) return new McpNotFoundError(err.message);
  return new McpInvalidError(err.message);
}

export async function requireExpenseAccess(ctx: McpCtx): Promise<void> {
  const roles = await getUserRoles(ctx.user.id, ctx.request);
  const denial = expenseAccessDenial({ isLabMemberOrAlum: roles.isLabMemberOrAlum, isAlumni: roles.isAlumni, readOnlyImpersonation: false });
  if (denial) throw new McpForbiddenError("Expenses are available to current lab members.");
}

export async function withViewer<T>(ctx: McpCtx, fn: (viewer: ExpenseViewer) => Promise<T>): Promise<T> {
  await requireExpenseAccess(ctx);
  try {
    return await fn(await loadExpenseViewer(ctx.user.id, ctx.request));
  } catch (err) {
    throw toMcpError(err);
  }
}

/** Replaces every `fooCents` number with a `foo` decimal string, deeply. */
export function presentMoney<T>(value: T): unknown {
  if (Array.isArray(value)) return value.map(presentMoney);
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.length > 5 && k.endsWith("Cents") && (typeof v === "number" || v === null)) {
      out[k.slice(0, -5)] = v === null ? null : centsToDecimalString(v);
    } else {
      out[k] = presentMoney(v);
    }
  }
  return out;
}

export function moneyToCents(raw: unknown, label: string): number | null {
  if (raw === null) return null;
  if (typeof raw !== "string") throw new McpInvalidError(`${label} must be a decimal string like "12.50".`);
  const cents = parseMoneyToCents(raw);
  if (cents === null) throw new McpInvalidError(`${label} must be a decimal string like "12.50".`);
  return cents;
}

export function parseDay(raw: unknown, label: string): Date {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new McpInvalidError(`${label} must be a date like 2026-11-17.`);
  }
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new McpInvalidError(`${label} must be a date like 2026-11-17.`);
  return d;
}
