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
// New tools added for UI parity
import { SUBMIT_ASSIGNMENT } from "./submit-assignment";
import { CHECK_IN_TO_SESSION } from "./check-in-to-session";
import { GRADE_SUBMISSION } from "./grade-submission";
import { GET_CERTIFICATE } from "./get-certificate";
import { MANAGE_OFFERING_MATERIALS } from "./manage-offering-materials";
import { READ_EDUCATION_PAGE } from "./read-education-page";
import { POST_EDUCATION_ANNOUNCEMENT } from "./post-education-announcement";
import { READ_EDUCATION_DISCUSSION } from "./read-education-discussion";
import { LIST_CE_COMPLIANCE } from "./list-ce-compliance";
import { GRANT_CE_CREDIT } from "./grant-ce-credit";
import { REMIND_CE_NONCOMPLIANT } from "./remind-ce-noncompliant";

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
  // New tools
  SUBMIT_ASSIGNMENT,
  CHECK_IN_TO_SESSION,
  GRADE_SUBMISSION,
  GET_CERTIFICATE,
  MANAGE_OFFERING_MATERIALS,
  READ_EDUCATION_PAGE,
  POST_EDUCATION_ANNOUNCEMENT,
  READ_EDUCATION_DISCUSSION,
  LIST_CE_COMPLIANCE,
  GRANT_CE_CREDIT,
  REMIND_CE_NONCOMPLIANT,
];
