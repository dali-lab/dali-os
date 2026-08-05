// MCP tool area: education. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";
import { LIST_EDUCATION_OFFERINGS } from "./list-education-offerings";
import { GET_EDUCATION_OFFERING } from "./get-education-offering";
import { LIST_MY_EDUCATION_APPLICATIONS } from "./list-my-education-applications";
import { GET_EDUCATION_ASSIGNMENT } from "./get-education-assignment";
import { GET_CE_CREDIT_STANDING } from "./get-ce-credit-standing";
import { SUBMIT_EDUCATION_APPLICATION } from "./submit-education-application";
import { WITHDRAW_EDUCATION_APPLICATION } from "./withdraw-education-application";
import { DECIDE_EDUCATION_APPLICATION } from "./decide-education-application";
import { SAVE_EDUCATION_ATTENDANCE } from "./save-education-attendance";
import { MANAGE_EDUCATION_OFFERING } from "./manage-education-offering";
import { MANAGE_EDUCATION_SESSION } from "./manage-education-session";
import { MANAGE_EDUCATION_ASSIGNMENT } from "./manage-education-assignment";
import { UPSERT_EDUCATION_STUDENT_NOTE } from "./upsert-education-student-note";
import { CLOSE_OUT_EDUCATION_OFFERING } from "./close-out-education-offering";

export const EDUCATION_TOOLS: McpTool[] = [
  LIST_EDUCATION_OFFERINGS,
  GET_EDUCATION_OFFERING,
  LIST_MY_EDUCATION_APPLICATIONS,
  GET_EDUCATION_ASSIGNMENT,
  GET_CE_CREDIT_STANDING,
  SUBMIT_EDUCATION_APPLICATION,
  WITHDRAW_EDUCATION_APPLICATION,
  DECIDE_EDUCATION_APPLICATION,
  SAVE_EDUCATION_ATTENDANCE,
  MANAGE_EDUCATION_OFFERING,
  MANAGE_EDUCATION_SESSION,
  MANAGE_EDUCATION_ASSIGNMENT,
  UPSERT_EDUCATION_STUDENT_NOTE,
  CLOSE_OUT_EDUCATION_OFFERING,
];
