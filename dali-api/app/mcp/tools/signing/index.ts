// MCP tool area: signing. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";
import { LIST_DOCUMENTS_TO_SIGN } from "./list-documents-to-sign";
import { GET_SIGNED_DOCUMENT } from "./get-signed-document";
import { GET_BINDING_TO_SIGN } from "./get-binding-to-sign";
import { LIST_MY_SIGNED_DOCUMENTS } from "./list-my-signed-documents";
import { LIST_AGREEMENT_SIGNATURES } from "./list-agreement-signatures";
import { LIST_AGREEMENTS } from "./list-agreements";
import { GET_SIGNED_DOCUMENT_ADMIN } from "./get-signed-document-admin";
import { SIGN_DOCUMENT } from "./sign-document";
import { MANAGE_AGREEMENT } from "./manage-agreement";
import { ISSUE_TERM_AGREEMENTS } from "./issue-term-agreements";

export const SIGNING_TOOLS: McpTool[] = [
  LIST_DOCUMENTS_TO_SIGN,
  GET_SIGNED_DOCUMENT,
  GET_BINDING_TO_SIGN,
  LIST_MY_SIGNED_DOCUMENTS,
  LIST_AGREEMENT_SIGNATURES,
  LIST_AGREEMENTS,
  GET_SIGNED_DOCUMENT_ADMIN,
  SIGN_DOCUMENT,
  MANAGE_AGREEMENT,
  ISSUE_TERM_AGREEMENTS,
];
