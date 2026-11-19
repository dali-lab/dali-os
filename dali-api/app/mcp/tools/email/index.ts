// MCP tool area: email. Aggregated into app/mcp/registry.ts.

import type { McpTool } from "../../registry";
import {
  GET_MAIL_THREAD_DEF,
  LIST_MAIL_INBOXES_DEF,
  LIST_MAIL_LABELS_DEF,
  SEARCH_MAIL_DEF,
  runGetMailThread,
  runListMailInboxes,
  runListMailLabels,
  runSearchMail,
} from "./read";
import { MAIL_FLAG } from "./shared";
import {
  COMMENT_ON_MAIL_THREAD_DEF,
  DRAFT_MAIL_DEF,
  LABEL_MAIL_THREAD_DEF,
  runCommentOnMailThread,
  runDraftMail,
  runLabelMailThread,
} from "./write";

export const EMAIL_TOOLS: McpTool[] = [
  { def: LIST_MAIL_INBOXES_DEF, run: runListMailInboxes },
  { def: LIST_MAIL_LABELS_DEF, run: runListMailLabels },
  { def: SEARCH_MAIL_DEF, run: runSearchMail },
  { def: GET_MAIL_THREAD_DEF, run: runGetMailThread },
  { def: LABEL_MAIL_THREAD_DEF, run: runLabelMailThread },
  { def: COMMENT_ON_MAIL_THREAD_DEF, run: runCommentOnMailThread },
  { def: DRAFT_MAIL_DEF, run: runDraftMail },
].map((t) => ({ ...t, featureFlag: MAIL_FLAG }));
