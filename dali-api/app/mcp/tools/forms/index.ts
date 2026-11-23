// MCP tool area: forms. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";
import { LIST_FORMS } from "./list-forms";
import { GET_FORM } from "./get-form";
import { GET_FORM_RESPONSES } from "./get-form-responses";
import { SUBMIT_FORM } from "./submit-form";
import { MANAGE_FORM } from "./manage-form";
import { SET_FORM_QUESTIONS } from "./set-form-questions";
import { REMIND_FORM_RESPONDENTS } from "./remind-form-respondents";

// Form folders are Drive Pages (kind=Folder) — manage them with the page tools
// (create_page / manage_page). No dedicated forms-folder tools.
export const FORMS_TOOLS: McpTool[] = [
  LIST_FORMS,
  GET_FORM,
  GET_FORM_RESPONSES,
  SUBMIT_FORM,
  MANAGE_FORM,
  SET_FORM_QUESTIONS,
  REMIND_FORM_RESPONDENTS,
];
