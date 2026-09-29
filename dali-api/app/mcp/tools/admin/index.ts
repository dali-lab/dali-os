// MCP tool area: admin. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";

import { LIST_DOMAINS_TOOL, runListDomains } from "./list-domains";
import { SEND_ANNOUNCEMENT_TOOL, runSendAnnouncement } from "./send-announcement";
import { MANAGE_GROUP_TOOL, runManageGroup } from "./manage-group";
import { MANAGE_DOMAIN_LEAD_TOOL, runManageDomainLead } from "./manage-domain-lead";
import { LIST_AUDIT_LOGS_TOOL, runListAuditLogs } from "./list-audit-logs";
import { MANAGE_JOB_TOOL, runManageJob } from "./manage-job";
import { MANAGE_FEATURE_FLAG_TOOL, runManageFeatureFlag } from "./manage-feature-flag";
import { LIST_EMAIL_SENDERS_TOOL, runListEmailSenders } from "./list-email-senders";
import { LIST_EMAIL_TEMPLATES_TOOL, runListEmailTemplates } from "./list-email-templates";
import { MANAGE_EMAIL_TEMPLATE_TOOL, runManageEmailTemplate } from "./manage-email-template";
import { LIST_ANNOUNCEMENTS_TOOL, runListAnnouncements } from "./list-announcements";
import {
  MANAGE_EMAIL_SENDER_TOOL,
  runManageEmailSender,
} from "./manage-email-sender";
import {
  LIST_OUTBOUND_MESSAGES_TOOL,
  runListOutboundMessages,
} from "./list-outbound-messages";
import {
  MANAGE_OUTBOUND_MESSAGE_TOOL,
  runManageOutboundMessage,
} from "./manage-outbound-message";
import { MANAGE_ACTIVITY_TOOL, runManageActivity } from "./manage-activity";
import { LIST_AI_USAGE_TOOL, runListAiUsage } from "./list-ai-usage";
import {
  GET_ATTENDANCE_OVERVIEW_TOOL,
  runGetAttendanceOverview,
} from "./get-attendance-overview";
import { LIST_INFRASTRUCTURE_TOOL, runListInfrastructure } from "./list-infrastructure";
import {
  CREATE_PAYROLL_CSV_UPLOAD_TOOL,
  runCreatePayrollCsvUpload,
  IMPORT_PAYROLL_CSVS_TOOL,
  runImportPayrollCsvs,
} from "./payroll-import";

export const ADMIN_TOOLS: McpTool[] = [
  {
    def: CREATE_PAYROLL_CSV_UPLOAD_TOOL,
    run: (ctx, args) =>
      runCreatePayrollCsvUpload(ctx.user.id, args as Parameters<typeof runCreatePayrollCsvUpload>[1]),
  },
  {
    def: IMPORT_PAYROLL_CSVS_TOOL,
    run: (ctx, args) =>
      runImportPayrollCsvs(ctx.user.id, args as Parameters<typeof runImportPayrollCsvs>[1]),
  },
  {
    def: LIST_DOMAINS_TOOL,
    run: (ctx) => runListDomains(ctx.user.id),
  },
  {
    def: SEND_ANNOUNCEMENT_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runSendAnnouncement(ctx.user.id, args as any),
  },
  {
    def: MANAGE_GROUP_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runManageGroup(ctx, args as any),
  },
  {
    def: MANAGE_DOMAIN_LEAD_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runManageDomainLead(ctx, args as any),
  },
  {
    def: LIST_AUDIT_LOGS_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runListAuditLogs(ctx, args as any),
  },
  {
    def: MANAGE_JOB_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runManageJob(ctx, args as any),
  },
  {
    def: MANAGE_FEATURE_FLAG_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runManageFeatureFlag(ctx, args as any),
  },
  {
    def: LIST_EMAIL_SENDERS_TOOL,
    run: (ctx) => runListEmailSenders(ctx),
  },
  {
    def: LIST_EMAIL_TEMPLATES_TOOL,
    run: (ctx) => runListEmailTemplates(ctx),
  },
  {
    def: MANAGE_EMAIL_TEMPLATE_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runManageEmailTemplate(ctx, args as any),
  },
  {
    def: LIST_ANNOUNCEMENTS_TOOL,
    run: (ctx) => runListAnnouncements(ctx),
  },
  {
    def: MANAGE_EMAIL_SENDER_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runManageEmailSender(ctx, args as any),
  },
  {
    def: LIST_OUTBOUND_MESSAGES_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runListOutboundMessages(ctx, args as any),
  },
  {
    def: MANAGE_OUTBOUND_MESSAGE_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runManageOutboundMessage(ctx, args as any),
  },
  {
    def: MANAGE_ACTIVITY_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runManageActivity(ctx, args as any),
  },
  {
    def: LIST_AI_USAGE_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runListAiUsage(ctx, args as any),
  },
  {
    def: GET_ATTENDANCE_OVERVIEW_TOOL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (ctx, args) => runGetAttendanceOverview(ctx, args as any),
  },
  {
    def: LIST_INFRASTRUCTURE_TOOL,
    run: (ctx) => runListInfrastructure(ctx),
  },
];
