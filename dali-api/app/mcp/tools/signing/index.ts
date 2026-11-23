// MCP tool area: signing. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";
import { LIST_MY_AGREEMENTS } from "./list-my-agreements";
import { GET_MY_AGREEMENT } from "./get-my-agreement";
import { LIST_AGREEMENT_SIGNATURES } from "./list-agreement-signatures";
import { LIST_AGREEMENTS } from "./list-agreements";
import { GET_SIGNED_DOCUMENT_ADMIN } from "./get-signed-document-admin";
import { SIGN_DOCUMENT } from "./sign-document";
import { MANAGE_AGREEMENT } from "./manage-agreement";
import { REMIND_AGREEMENT_SIGNERS } from "./remind-agreement-signers";
import { ISSUE_TERM_AGREEMENTS } from "./issue-term-agreements";

export const SIGNING_TOOLS: McpTool[] = [
  LIST_MY_AGREEMENTS,
  GET_MY_AGREEMENT,
  LIST_AGREEMENT_SIGNATURES,
  LIST_AGREEMENTS,
  GET_SIGNED_DOCUMENT_ADMIN,
  SIGN_DOCUMENT,
  MANAGE_AGREEMENT,
  REMIND_AGREEMENT_SIGNERS,
  ISSUE_TERM_AGREEMENTS,
];
