// MCP tool area: signing. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";
import { LIST_DOCUMENTS_TO_SIGN } from "./list-documents-to-sign";
import { GET_SIGNED_DOCUMENT } from "./get-signed-document";
import { LIST_AGREEMENT_SIGNATURES } from "./list-agreement-signatures";
import { SIGN_DOCUMENT } from "./sign-document";
import { MANAGE_AGREEMENT } from "./manage-agreement";

export const SIGNING_TOOLS: McpTool[] = [
  LIST_DOCUMENTS_TO_SIGN,
  GET_SIGNED_DOCUMENT,
  LIST_AGREEMENT_SIGNATURES,
  SIGN_DOCUMENT,
  MANAGE_AGREEMENT,
];
