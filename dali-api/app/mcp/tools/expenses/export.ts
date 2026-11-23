import { randomUUID } from "node:crypto";
import { exportExpensesCsv, exportExpensesPdf } from "~/expenses/lib/export.server";
import type { ExpenseFilters } from "~/expenses/lib/expenses.server";
import { getDownloadUrl, isS3Configured, putObject } from "~/lib/s3.server";
import type { McpCtx } from "../../registry";
import { McpInvalidError } from "../../errors";
import { parseDay, withViewer } from "./shared";

export const EXPORT_URL_TTL_SECONDS = 300;

export async function exportExpensesFile(ctx: McpCtx, args: Record<string, unknown>, format: "csv" | "pdf") {
  if (!isS3Configured()) throw new McpInvalidError("File storage is not configured in this environment");
  const scope = (args.scope as "mine" | "approvals" | "all" | undefined) ?? "mine";
  const filters: ExpenseFilters = {
    status: args.status as ExpenseFilters["status"],
    cardId: args.cardId as string | undefined,
    categoryId: args.categoryId as string | undefined,
    termId: args.termId as string | undefined,
    from: args.from === undefined ? undefined : parseDay(args.from, "from"),
    to: args.to === undefined ? undefined : parseDay(args.to, "to"),
    noReceipt: args.noReceipt as boolean | undefined,
    outstanding: args.outstanding as boolean | undefined,
  };

  const bytes = await withViewer(ctx, async (v) =>
    format === "csv"
      ? new TextEncoder().encode(await exportExpensesCsv(v, scope, filters))
      : await exportExpensesPdf(v, scope, filters),
  );

  const fileName = `expenses-${new Date().toISOString().slice(0, 10)}.${format}`;
  const key = `exports/expenses/${ctx.user.id}/${randomUUID()}.${format}`;
  const contentType = format === "csv" ? "text/csv" : "application/pdf";
  await putObject(key, bytes, contentType);
  const url = await getDownloadUrl(key, { expiresIn: EXPORT_URL_TTL_SECONDS, fileName, contentType });
  return { format, fileName, url, expiresInSeconds: EXPORT_URL_TTL_SECONDS };
}
