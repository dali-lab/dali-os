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

export const ADMIN_TOOLS: McpTool[] = [
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
];
