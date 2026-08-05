// MCP tool area: forms. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";
import { LIST_FORMS } from "./list-forms";
import { GET_FORMS_FOLDER } from "./get-forms-folder";
import { GET_FORM_RESPONSES } from "./get-form-responses";
import { SUBMIT_FORM } from "./submit-form";
import { MANAGE_FORM } from "./manage-form";
import { MANAGE_FORMS_FOLDER } from "./manage-forms-folder";

export const FORMS_TOOLS: McpTool[] = [
  LIST_FORMS,
  GET_FORMS_FOLDER,
  GET_FORM_RESPONSES,
  SUBMIT_FORM,
  MANAGE_FORM,
  MANAGE_FORMS_FOLDER,
];
