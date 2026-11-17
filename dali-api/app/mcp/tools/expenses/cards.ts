import {
  archiveCard,
  archiveCategory,
  createCard,
  createCategory,
  importStatement,
  listCards,
  listCharges,
  updateCard,
  updateCategory,
} from "~/expenses/lib/expenses.server";
import {
  assertOwnStatementKey,
  createStatementUpload,
  deleteStatementUpload,
  readStatementText,
  STATEMENT_MAX_BYTES,
} from "~/expenses/lib/statement-upload.server";
import { isS3Configured } from "~/lib/s3.server";
import type { McpCtx } from "../../registry";
import { McpInvalidError, requireForAction } from "../../errors";
import { curlCommand } from "../presigned-upload";
import { presentMoney, withViewer } from "./shared";

type Args = Record<string, unknown>;

export const LIST_EXPENSE_CARDS_DEF = {
  name: "list_expense_cards",
  description:
    "List staff cards the caller can see: Core sees all, a card owner sees their cards, and a holder sees the cards they can file on. Each card has its nickname, last four digits, owner, holders and default category. Use the ids for cardId on manage_expense, list_card_charges and create_card_statement_upload.",
  inputSchema: {
    type: "object" as const,
    properties: { includeArchived: { type: "boolean" } },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export const MANAGE_EXPENSE_CARD_DEF = {
  name: "manage_expense_card",
  description:
    "Core only. Add or change a staff card. Actions: 'create' (needs nickname, last4 as exactly four digits, and ownerId, who has to be a staff member; optional holderIds, who can file on the card, and defaultCategoryId); 'update' (needs cardId and any of the same fields); 'archive' (needs cardId; if expenses on the card are waiting for approval it changes nothing and returns needsConfirm with submittedCount, so repeat with confirm true to archive anyway). Returns the card.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["create", "update", "archive"] },
      cardId: { type: "string", minLength: 1 },
      nickname: { type: "string", maxLength: 100 },
      last4: { type: "string", minLength: 4, maxLength: 4 },
      ownerId: { type: "string", minLength: 1 },
      holderIds: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 100 },
      defaultCategoryId: { type: "string", minLength: 1 },
      confirm: { type: "boolean", description: "Archive even if submitted expenses are waiting." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const MANAGE_EXPENSE_CATEGORY_DEF = {
  name: "manage_expense_category",
  description:
    "Core only. Add or change an expense category. Actions: 'create' (needs label; optional chartString, which has to be a valid chart string, hints as lowercase keywords that help suggest the category from a receipt, and sortOrder); 'update' (needs categoryId and any of the same fields); 'archive' (needs categoryId; archived categories can't be picked on new expenses). Returns the category.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["create", "update", "archive"] },
      categoryId: { type: "string", minLength: 1 },
      label: { type: "string", maxLength: 100 },
      chartString: { type: "string", maxLength: 100 },
      hints: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 50 },
      sortOrder: { type: "integer", minimum: 0 },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const CREATE_CARD_STATEMENT_UPLOAD_DEF = {
  name: "create_card_statement_upload",
  description: `Start uploading a card statement CSV. Returns a presigned S3 POST, a ready curl command for a POSIX shell and the key. Run the curl with the local file path and expect a final line of HTTP 204, then call import_card_statement with the same cardId, the key and a column mapping. Max ${STATEMENT_MAX_BYTES / 1024 / 1024} MB; the link expires after 15 minutes. Only the card's owner or Core.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      cardId: { type: "string", minLength: 1 },
      fileName: { type: "string", minLength: 1, maxLength: 255, description: "The CSV's file name. Must end in .csv." },
    },
    required: ["cardId", "fileName"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const IMPORT_CARD_STATEMENT_DEF = {
  name: "import_card_statement",
  description:
    "Import a statement CSV uploaded with create_card_statement_upload into a card. The mapping names the CSV's column headers exactly: date, merchant and amount. Set invertSign true when the bank lists purchases as negative numbers. Charges already imported are skipped, new charges are matched to expenses, and the file is deleted afterwards. Returns imported, skipped, matched, needsReceipt, notOnStatement and ambiguous counts plus row errors. Only the card's owner or Core.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cardId: { type: "string", minLength: 1 },
      key: { type: "string", minLength: 1, maxLength: 1024, description: "Key from create_card_statement_upload." },
      mapping: {
        type: "object",
        properties: {
          date: { type: "string", minLength: 1, description: "Header of the date column." },
          merchant: { type: "string", minLength: 1, description: "Header of the merchant or description column." },
          amount: { type: "string", minLength: 1, description: "Header of the amount column." },
          invertSign: { type: "boolean" },
        },
        required: ["date", "merchant", "amount"],
        additionalProperties: false,
      },
    },
    required: ["cardId", "key", "mapping"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const LIST_CARD_CHARGES_DEF = {
  name: "list_card_charges",
  description:
    "List imported statement charges on a card, newest first. state 'needs_receipt' is a charge with no expense, 'matched' has one, 'refund' is a credit. Amounts are decimal strings. Only the card's owner or Core.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cardId: { type: "string", minLength: 1 },
      state: { type: "string", enum: ["matched", "needs_receipt", "refund"] },
      limit: { type: "integer", minimum: 1, maximum: 1000 },
    },
    required: ["cardId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListExpenseCards(ctx: McpCtx, args: Args) {
  return { cards: await withViewer(ctx, (v) => listCards(v, { includeArchived: args.includeArchived === true })) };
}

const CARD_REQUIRED = { create: ["nickname", "last4", "ownerId"], update: ["cardId"], archive: ["cardId"] };

export async function runManageExpenseCard(ctx: McpCtx, args: Args) {
  const action = args.action as "create" | "update" | "archive";
  requireForAction(action, args, CARD_REQUIRED);
  const input = {
    ...(args.nickname !== undefined && { nickname: args.nickname as string }),
    ...(args.last4 !== undefined && { last4: args.last4 as string }),
    ...(args.ownerId !== undefined && { ownerId: args.ownerId as string }),
    ...(args.holderIds !== undefined && { holderIds: args.holderIds as string[] }),
    ...(args.defaultCategoryId !== undefined && { defaultCategoryId: args.defaultCategoryId as string }),
  };
  return withViewer(ctx, async (v) => {
    if (action === "create") return createCard(v, input as Parameters<typeof createCard>[1]);
    if (action === "update") return updateCard(v, args.cardId as string, input);
    return archiveCard(v, args.cardId as string, { confirm: args.confirm === true });
  });
}

const CATEGORY_REQUIRED = { create: ["label"], update: ["categoryId"], archive: ["categoryId"] };

export async function runManageExpenseCategory(ctx: McpCtx, args: Args) {
  const action = args.action as "create" | "update" | "archive";
  requireForAction(action, args, CATEGORY_REQUIRED);
  const input = {
    ...(args.label !== undefined && { label: args.label as string }),
    ...(args.chartString !== undefined && { chartString: args.chartString as string }),
    ...(args.hints !== undefined && { hints: args.hints as string[] }),
    ...(args.sortOrder !== undefined && { sortOrder: args.sortOrder as number }),
  };
  return withViewer(ctx, async (v) => {
    if (action === "create") return createCategory(v, input as Parameters<typeof createCategory>[1]);
    if (action === "update") return updateCategory(v, args.categoryId as string, input);
    return archiveCategory(v, args.categoryId as string);
  });
}

export async function runCreateCardStatementUpload(ctx: McpCtx, args: Args) {
  const fileName = (args.fileName as string).trim();
  if (!/\.csv$/i.test(fileName)) throw new McpInvalidError("The file must be a .csv.");
  if (!isS3Configured()) throw new McpInvalidError("File storage is not configured in this environment");
  const { key, post } = await withViewer(ctx, (v) => createStatementUpload(v, args.cardId as string));
  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return {
    cardId: args.cardId,
    key,
    uploadUrl: post.url,
    fields: post.fields,
    maxBytes: STATEMENT_MAX_BYTES,
    curl: curlCommand(post.url, post.fields, safeName),
    next: "Replace /path/to/… with the local file path and run the curl command; a final line of HTTP 204 means stored. Then call import_card_statement with this cardId, the key and a column mapping.",
  };
}

export async function runImportCardStatement(ctx: McpCtx, args: Args) {
  const key = (args.key as string).trim();
  const mapping = args.mapping as { date: string; merchant: string; amount: string; invertSign?: boolean };
  return withViewer(ctx, async (v) => {
    assertOwnStatementKey(v.userId, key);
    try {
      const text = await readStatementText(v.userId, key);
      return await importStatement(v, args.cardId as string, text, mapping);
    } finally {
      await deleteStatementUpload(v.userId, key);
    }
  });
}

export async function runListCardCharges(ctx: McpCtx, args: Args) {
  const rows = await withViewer(ctx, (v) =>
    listCharges(v, args.cardId as string, {
      state: args.state as "matched" | "needs_receipt" | "refund" | undefined,
      limit: args.limit as number | undefined,
    }),
  );
  return { charges: presentMoney(rows) };
}
