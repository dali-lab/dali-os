// MCP tool area: expenses. Aggregated into app/mcp/registry.ts.

import type { McpTool } from "../../registry";
import {
  CREATE_CARD_STATEMENT_UPLOAD_DEF,
  IMPORT_CARD_STATEMENT_DEF,
  LIST_CARD_CHARGES_DEF,
  LIST_EXPENSE_CARDS_DEF,
  MANAGE_EXPENSE_CARD_DEF,
  MANAGE_EXPENSE_CATEGORY_DEF,
  runCreateCardStatementUpload,
  runImportCardStatement,
  runListCardCharges,
  runListExpenseCards,
  runManageExpenseCard,
  runManageExpenseCategory,
} from "./cards";
import {
  CREATE_EXPENSE_RECEIPT_UPLOAD_DEF,
  DECIDE_EXPENSE_DEF,
  GET_EXPENSE_DEF,
  LIST_EXPENSES_DEF,
  LIST_EXPENSE_CATEGORIES_DEF,
  MANAGE_EXPENSE_DEF,
  runCreateExpenseReceiptUpload,
  runDecideExpense,
  runGetExpense,
  runListExpenseCategories,
  runListExpenses,
  runManageExpense,
} from "./expenses";
import { EXPENSES_FLAG } from "./shared";

export const EXPENSES_TOOLS: McpTool[] = [
  { def: LIST_EXPENSES_DEF, run: runListExpenses },
  { def: GET_EXPENSE_DEF, run: runGetExpense },
  { def: CREATE_EXPENSE_RECEIPT_UPLOAD_DEF, run: runCreateExpenseReceiptUpload },
  { def: MANAGE_EXPENSE_DEF, run: runManageExpense },
  { def: DECIDE_EXPENSE_DEF, run: runDecideExpense },
  { def: LIST_EXPENSE_CATEGORIES_DEF, run: runListExpenseCategories },
  { def: LIST_EXPENSE_CARDS_DEF, run: runListExpenseCards },
  { def: MANAGE_EXPENSE_CARD_DEF, run: runManageExpenseCard },
  { def: MANAGE_EXPENSE_CATEGORY_DEF, run: runManageExpenseCategory },
  { def: CREATE_CARD_STATEMENT_UPLOAD_DEF, run: runCreateCardStatementUpload },
  { def: IMPORT_CARD_STATEMENT_DEF, run: runImportCardStatement },
  { def: LIST_CARD_CHARGES_DEF, run: runListCardCharges },
].map((t) => ({ ...t, featureFlag: EXPENSES_FLAG }));
