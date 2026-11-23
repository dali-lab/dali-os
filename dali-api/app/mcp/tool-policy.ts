import type { UserRoles } from "~/lib/roles";
import type { McpToolDef } from "./registry";

export type McpAudience = "core" | "admin";

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
};

const AUDIENCE_ALLOWS: Record<McpAudience, (roles: UserRoles) => boolean> = {
  core: (r) => r.isCore,
  admin: (r) => r.isAdmin,
};

const byAudience = (audience: McpAudience, names: string[]) =>
  Object.fromEntries(names.map((n) => [n, audience] as const));

// Only tools whose own gate rejects everyone outside the audience, whatever the args.
export const TOOL_AUDIENCE: Record<string, McpAudience> = {
  ...byAudience("core", [
    "apply_doc_tag",
    "correct_assignment_level",
    "create_member",
    "create_project",
    "finalize_staffing",
    "get_attendance_overview",
    "get_partner_application",
    "get_partner_org",
    "get_partner_sow",
    "get_signed_document_admin",
    "get_staffing_board",
    "grant_ce_credit",
    "issue_term_agreements",
    "list_agreement_signatures",
    "list_agreements",
    "list_ai_usage",
    "list_announcements",
    "list_audit_logs",
    "list_ce_compliance",
    "list_core_milestones",
    "list_domains",
    "list_email_senders",
    "list_email_templates",
    "list_outbound_messages",
    "list_partner_activity",
    "list_partner_applications",
    "list_partner_contacts",
    "list_partner_orgs",
    "list_project_chart_strings",
    "manage_activity",
    "manage_agreement",
    "manage_core_milestone",
    "manage_doc_tags",
    "manage_email_sender",
    "manage_email_template",
    "manage_feature_flag",
    "manage_job",
    "manage_mentor_note_template",
    "manage_mentorship_pair",
    "manage_outbound_message",
    "manage_partner_application",
    "manage_partner_contact",
    "manage_partner_invoice",
    "manage_partner_meeting",
    "manage_partner_member",
    "manage_partner_org",
    "manage_partner_project_link",
    "manage_project_template",
    "manage_staffing",
    "partner_pipeline_report",
    "promote_partner_application",
    "remind_agreement_signers",
    "remind_ce_noncompliant",
    "respond_partner_meeting_request",
    "send_announcement",
    "set_domain_eligibility",
    "set_project_chart_string",
    "set_staffing_assignment",
  ]),
  ...byAudience("admin", [
    "backfill_hiring_cycle",
    "create_payroll_csv_upload",
    "get_backfill_state",
    "import_payroll_csvs",
    "manage_domain_lead",
    "manage_group",
  ]),
};

// Writes that only add records. Every other write keeps MCP's destructive default.
export const ADDITIVE_TOOLS = new Set<string>([
  "add_task_comment",
  "book_room",
  "check_in_to_meeting",
  "check_in_to_session",
  "complete_onboarding_tour",
  "create_card_statement_upload",
  "create_expense_receipt_upload",
  "create_gallery_upload",
  "create_lab_document",
  "create_member",
  "create_page",
  "create_payroll_csv_upload",
  "create_project",
  "create_project_file_upload",
  "create_slide_deck",
  "draft_mail",
  "grant_ce_credit",
  "issue_term_agreements",
  "name_collab_version",
  "post_education_announcement",
  "provision_epic_description_doc",
  "remind_ce_noncompliant",
  "schedule_meeting",
  "send_announcement",
  "sign_document",
  "submit_form",
  "upload_drive_file",
  "upload_project_file",
]);

// Tools that email, notify, invite or reach an outside system (Google, Slack, GitHub, Gmail).
export const OPEN_WORLD_TOOLS = new Set<string>([
  "cancel_meeting",
  "close_out_education_offering",
  "comment_on_mail_thread",
  "draft_mail",
  "finalize_staffing",
  "issue_term_agreements",
  "label_mail_thread",
  "manage_agreement",
  "manage_email_template",
  "manage_gallery_post",
  "manage_offering_instructors",
  "manage_outbound_message",
  "manage_partner_meeting",
  "manage_partner_member",
  "manage_task",
  "post_education_announcement",
  "remind_agreement_signers",
  "remind_ce_noncompliant",
  "remind_form_respondents",
  "respond_partner_meeting_request",
  "review_journey_submission",
  "rsvp_to_notification",
  "schedule_meeting",
  "send_announcement",
]);

export function audienceAllows(toolName: string, roles: UserRoles): boolean {
  const audience = TOOL_AUDIENCE[toolName];
  return audience === undefined || AUDIENCE_ALLOWS[audience](roles);
}

export function toolAnnotations(def: McpToolDef): McpToolAnnotations {
  if (def.requiredScope === "mcp:read") return { readOnlyHint: true };
  return {
    readOnlyHint: false,
    destructiveHint: !ADDITIVE_TOOLS.has(def.name),
    openWorldHint: OPEN_WORLD_TOOLS.has(def.name),
  };
}
