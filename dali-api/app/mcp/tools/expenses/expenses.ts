import {
  createFromReceipts,
  createNoReceipt,
  decideExpense,
  deleteDraft,
  getExpense,
  listCategories,
  listExpenses,
  markPaid,
  matchCharge,
  submitExpense,
  unmatchCharge,
  updateExpense,
  withdrawExpense,
  type ExpenseFilters,
  type NoReceiptFields,
  type UpdateExpenseInput,
} from "~/expenses/lib/expenses.server";
import { createReceiptUpload, ReceiptKeyError } from "~/expenses/lib/receipts.server";
import { isS3Configured } from "~/lib/s3.server";
import type { McpCtx } from "../../registry";
import { McpInvalidError, requireForAction } from "../../errors";
import { curlCommand } from "../presigned-upload";
import { moneyToCents, parseDay, presentMoney, requireExpenseAccess, withViewer } from "./shared";

const STATUSES = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "PAID"];

export const LIST_EXPENSES_DEF = {
  name: "list_expenses",
  description:
    "List expenses. scope 'mine' (default) is the caller's own; 'approvals' is what the caller can approve (staff see everyone's, a card owner sees expenses on their staff cards; defaults to status SUBMITTED); 'all' is every expense and is for Core and staff only. Filter by status, cardId, categoryId, termId, a purchase date range (from, to as YYYY-MM-DD), noReceipt, or outstanding (approved expenses paid on the filer's own card, owed back to them). Amounts are decimal strings. Use get_expense for one expense's receipts, checks and links.",
  inputSchema: {
    type: "object" as const,
    properties: {
      scope: { type: "string", enum: ["mine", "approvals", "all"] },
      status: { type: "array", items: { type: "string", enum: STATUSES }, maxItems: 5 },
      cardId: { type: "string", minLength: 1 },
      categoryId: { type: "string", minLength: 1 },
      termId: { type: "string", minLength: 1 },
      from: { type: "string", description: "Earliest purchase date, YYYY-MM-DD." },
      to: { type: "string", description: "Latest purchase date, YYYY-MM-DD." },
      noReceipt: { type: "boolean" },
      outstanding: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      offset: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export const GET_EXPENSE_DEF = {
  name: "get_expense",
  description:
    "One expense with its receipts (short-lived download links), extracted fields, category suggestion, matched statement charge and the checks (duplicate receipt, missing receipt, total mismatch). Only the filer, staff, Core and the card's owner can see it. Amounts are decimal strings.",
  inputSchema: {
    type: "object" as const,
    properties: { expenseId: { type: "string", minLength: 1 } },
    required: ["expenseId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export const CREATE_EXPENSE_RECEIPT_UPLOAD_DEF = {
  name: "create_expense_receipt_upload",
  description:
    "Start uploading one receipt for an expense. Returns a presigned S3 POST, a ready curl command for a POSIX shell and the receipt key. Run the curl with the local file path and expect a final line of HTTP 204. Call this once per file (an expense takes up to 12), then call manage_expense with action 'create' and the keys as receiptKeys. Accepts JPEG, PNG, WebP and PDF; HEIC has to be converted to JPEG first. The link expires after 15 minutes, and the key only works for the caller.",
  inputSchema: {
    type: "object" as const,
    properties: {
      contentType: { type: "string", enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"] },
      fileName: {
        type: "string",
        minLength: 1,
        maxLength: 255,
        description: "The local file's name, used only to build the curl command.",
      },
    },
    required: ["contentType", "fileName"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const EXPENSE_ACTIONS = [
  "create",
  "create_no_receipt",
  "update",
  "submit",
  "withdraw",
  "delete",
  "mark_paid",
  "match_charge",
  "unmatch_charge",
] as const;

export const MANAGE_EXPENSE_DEF = {
  name: "manage_expense",
  description: `Create and change expenses, with the same rules as the Expenses page. Money is a decimal string such as "12.50"; dates are YYYY-MM-DD. Actions: 'create' (needs receiptKeys from create_expense_receipt_upload; optional paidWith 'STAFF_CARD' or 'OWN_CARD' and cardId; reads the receipts and fills in the merchant, date, total and a category suggestion; saves a draft; with noReceipt true it files without receipts and needs noReceiptReason); 'create_no_receipt' (needs noReceiptReason; optional merchant, purchasedAt, total, purpose, categoryId, paidWith, cardId, or chargeId to file against a statement charge that has no receipt); 'update' (needs expenseId and any of merchant, purchasedAt, total, purpose, categoryId, projectId, attendeeIds, paidWith, cardId, noReceiptReason; the filer edits drafts and returned expenses, approvers can change only categoryId and purpose on a submitted one); 'submit' (needs expenseId; a draft or returned expense with a merchant, date, total and category); 'withdraw' (needs expenseId; filer, while submitted); 'delete' (needs expenseId; a draft only, and removes its receipts); 'mark_paid' (needs expenseId; staff, or the filer for their own approved expense); 'match_charge' (needs expenseId and chargeId; card owner or Core; ties an expense to a statement charge on the same card); 'unmatch_charge' (needs expenseId). Approving and returning are in decide_expense. Returns the expense.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: [...EXPENSE_ACTIONS] },
      expenseId: { type: "string", minLength: 1 },
      receiptKeys: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 1024 },
        minItems: 1,
        maxItems: 12,
        description: "Keys from create_expense_receipt_upload.",
      },
      paidWith: { type: "string", enum: ["STAFF_CARD", "OWN_CARD"] },
      cardId: { type: "string", minLength: 1 },
      chargeId: { type: "string", minLength: 1 },
      noReceipt: { type: "boolean" },
      noReceiptReason: { type: "string", maxLength: 1000 },
      merchant: { type: "string", maxLength: 200 },
      purchasedAt: { type: "string", description: "YYYY-MM-DD." },
      total: { type: "string", description: 'Decimal string, e.g. "42.10".' },
      purpose: { type: "string", maxLength: 2000 },
      categoryId: { type: "string", minLength: 1 },
      projectId: { type: "string", minLength: 1 },
      attendeeIds: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 100 },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const DECIDE_EXPENSE_DEF = {
  name: "decide_expense",
  description:
    "Approve or return a submitted expense. Staff can decide any expense, and a card's owner can decide expenses on their staff card; nobody can decide their own. Approving needs a category and records its chart string. Returning needs a note that tells the filer what to fix. Notifies the filer. Returns the expense.",
  inputSchema: {
    type: "object" as const,
    properties: {
      expenseId: { type: "string", minLength: 1 },
      decision: { type: "string", enum: ["approve", "return"] },
      note: { type: "string", maxLength: 2000, description: "Required when returning." },
    },
    required: ["expenseId", "decision"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const LIST_EXPENSE_CATEGORIES_DEF = {
  name: "list_expense_categories",
  description:
    "List expense categories with their chart strings and keyword hints, in display order. Use the ids for categoryId on manage_expense and list_expenses.",
  inputSchema: {
    type: "object" as const,
    properties: { includeArchived: { type: "boolean" } },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function runListExpenses(ctx: McpCtx, args: Args) {
  const filters: ExpenseFilters = {
    status: args.status as ExpenseFilters["status"],
    cardId: str(args.cardId),
    categoryId: str(args.categoryId),
    termId: str(args.termId),
    from: args.from === undefined ? undefined : parseDay(args.from, "from"),
    to: args.to === undefined ? undefined : parseDay(args.to, "to"),
    noReceipt: args.noReceipt as boolean | undefined,
    outstanding: args.outstanding as boolean | undefined,
    limit: args.limit as number | undefined,
    offset: args.offset as number | undefined,
  };
  const scope = (str(args.scope) ?? "mine") as "mine" | "approvals" | "all";
  const rows = await withViewer(ctx, (v) => listExpenses(v, scope, filters));
  return { expenses: presentMoney(rows) };
}

export async function runGetExpense(ctx: McpCtx, args: Args) {
  return presentMoney(await withViewer(ctx, (v) => getExpense(v, args.expenseId as string)));
}

export async function runCreateExpenseReceiptUpload(ctx: McpCtx, args: Args) {
  await requireExpenseAccess(ctx);
  if (!isS3Configured()) throw new McpInvalidError("File storage is not configured in this environment");
  try {
    const { key, post, contentType } = await createReceiptUpload(ctx.user.id, args.contentType as string);
    const safeName = (args.fileName as string).replace(/[^A-Za-z0-9._-]/g, "_");
    return {
      key,
      contentType,
      uploadUrl: post.url,
      fields: post.fields,
      curl: curlCommand(post.url, post.fields, safeName),
      next: "Replace /path/to/… with the local file path and run the curl command; a final line of HTTP 204 means stored. Then call manage_expense with action 'create' and this key in receiptKeys.",
    };
  } catch (err) {
    if (err instanceof ReceiptKeyError) throw new McpInvalidError(err.message);
    throw err;
  }
}

const REQUIRED: Record<(typeof EXPENSE_ACTIONS)[number], string[]> = {
  create: [],
  create_no_receipt: ["noReceiptReason"],
  update: ["expenseId"],
  submit: ["expenseId"],
  withdraw: ["expenseId"],
  delete: ["expenseId"],
  mark_paid: ["expenseId"],
  match_charge: ["expenseId", "chargeId"],
  unmatch_charge: ["expenseId"],
};

function fieldsFrom(args: Args) {
  const fields: NoReceiptFields & UpdateExpenseInput = {};
  if (args.merchant !== undefined) fields.merchant = args.merchant as string;
  if (args.purchasedAt !== undefined) fields.purchasedAt = parseDay(args.purchasedAt, "purchasedAt");
  if (args.total !== undefined) fields.totalCents = moneyToCents(args.total, "total");
  if (args.purpose !== undefined) fields.purpose = args.purpose as string;
  if (args.categoryId !== undefined) fields.categoryId = args.categoryId as string;
  if (args.projectId !== undefined) fields.projectId = args.projectId as string;
  if (args.attendeeIds !== undefined) fields.attendeeIds = args.attendeeIds as string[];
  if (args.paidWith !== undefined) fields.paidWith = args.paidWith as "STAFF_CARD" | "OWN_CARD";
  if (args.cardId !== undefined) fields.cardId = args.cardId as string;
  if (args.noReceiptReason !== undefined) fields.noReceiptReason = args.noReceiptReason as string;
  return fields;
}

export async function runManageExpense(ctx: McpCtx, args: Args) {
  const action = args.action as (typeof EXPENSE_ACTIONS)[number];
  requireForAction(action, args, REQUIRED);
  const id = args.expenseId as string;

  if (action === "create" && !args.noReceipt && args.receiptKeys === undefined) {
    throw new McpInvalidError("action 'create' requires: receiptKeys (or noReceipt true with noReceiptReason)");
  }
  if (action === "create" && args.noReceipt) requireForAction("create_no_receipt", args, REQUIRED);

  const { noReceiptReason: _reason, ...noReceiptFields } = fieldsFrom(args);
  const fields = fieldsFrom(args);
  const result = await withViewer(ctx, async (v) => {
    switch (action) {
      case "create":
        if (args.noReceipt) {
          return createNoReceipt(v, noReceiptFields, args.noReceiptReason as string, str(args.chargeId));
        }
        return createFromReceipts(v, args.receiptKeys as string[], {
          paidWith: fields.paidWith,
          cardId: fields.cardId,
        });
      case "create_no_receipt":
        return createNoReceipt(v, noReceiptFields, args.noReceiptReason as string, str(args.chargeId));
      case "update":
        return updateExpense(v, id, fields);
      case "submit":
        return submitExpense(v, id);
      case "withdraw":
        return withdrawExpense(v, id);
      case "delete":
        await deleteDraft(v, id);
        return { deleted: true, expenseId: id };
      case "mark_paid":
        return markPaid(v, id);
      case "match_charge":
        return matchCharge(v, id, args.chargeId as string);
      case "unmatch_charge":
        return unmatchCharge(v, id);
    }
  });
  return presentMoney(result);
}

export async function runDecideExpense(ctx: McpCtx, args: Args) {
  const decision = args.decision as "approve" | "return";
  if (decision === "return" && !str(args.note)?.trim()) {
    throw new McpInvalidError("Add a note that tells the filer what to fix.");
  }
  return presentMoney(
    await withViewer(ctx, (v) =>
      decideExpense(v, args.expenseId as string, { decision, note: str(args.note) }),
    ),
  );
}

export async function runListExpenseCategories(ctx: McpCtx, args: Args) {
  await requireExpenseAccess(ctx);
  return { categories: await listCategories({ includeArchived: args.includeArchived === true }) };
}
