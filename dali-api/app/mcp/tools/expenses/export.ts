import { randomUUID } from "node:crypto";
import { exportExpensesCsv, exportExpensesPdf } from "~/expenses/lib/export.server";
import type { ExpenseFilters } from "~/expenses/lib/expenses.server";
import { getDownloadUrl, isS3Configured, putObject } from "~/lib/s3.server";
import type { McpCtx } from "../../registry";
import { McpInvalidError } from "../../errors";
import { parseDay, withViewer } from "./shared";

export const EXPORT_URL_TTL_SECONDS = 300;

export const EXPORT_EXPENSES_DEF = {
  name: "export_expenses",
  description:
    "Export expenses as a CSV or PDF file, the same export as the Expenses page, for the scope and filters given (same meaning as list_expenses; 'all' is Core and staff only). Returns a download URL that expires in 5 minutes, with the file name and format. Download it with curl -L -o <file> '<url>'.",
  inputSchema: {
    type: "object" as const,
    properties: {
      format: { type: "string", enum: ["csv", "pdf"] },
      scope: { type: "string", enum: ["mine", "approvals", "all"] },
      status: { type: "array", items: { type: "string", enum: ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "PAID"] }, maxItems: 5 },
      cardId: { type: "string", minLength: 1 },
      categoryId: { type: "string", minLength: 1 },
      termId: { type: "string", minLength: 1 },
      from: { type: "string", description: "Earliest purchase date, YYYY-MM-DD." },
      to: { type: "string", description: "Latest purchase date, YYYY-MM-DD." },
      noReceipt: { type: "boolean" },
      outstanding: { type: "boolean" },
    },
    required: ["format"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runExportExpenses(ctx: McpCtx, args: Record<string, unknown>) {
  if (!isS3Configured()) throw new McpInvalidError("File storage is not configured in this environment");
  const format = args.format as "csv" | "pdf";
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
