// MCP tool area: partners. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool, McpCtx } from "../../registry";

import {
  LIST_PARTNER_ORGS_TOOL,
  runListPartnerOrgs,
} from "./list-partner-orgs";
import {
  GET_PARTNER_ORG_TOOL,
  runGetPartnerOrg,
} from "./get-partner-org";
import {
  LIST_PARTNER_APPLICATIONS_TOOL,
  runListPartnerApplications,
} from "./list-partner-applications";
import {
  GET_PARTNER_APPLICATION_TOOL,
  runGetPartnerApplication,
} from "./get-partner-application";
import {
  MANAGE_PARTNER_ORG_TOOL,
  runManagePartnerOrg,
} from "./manage-partner-org";
import {
  MANAGE_PARTNER_MEMBER_TOOL,
  runManagePartnerMember,
} from "./manage-partner-member";
import {
  MANAGE_PARTNER_APPLICATION_TOOL,
  runManagePartnerApplication,
} from "./manage-partner-application";
import {
  MANAGE_PARTNER_PROJECT_LINK_TOOL,
  runManagePartnerProjectLink,
} from "./manage-partner-project-link";
import {
  PROMOTE_PARTNER_APPLICATION_TOOL,
  runPromotePartnerApplication,
} from "./promote-partner-application";

export const PARTNERS_TOOLS: McpTool[] = [
  {
    def: LIST_PARTNER_ORGS_TOOL,
    run: (ctx: McpCtx, args) => runListPartnerOrgs(ctx.user.id, args),
  },
  {
    def: GET_PARTNER_ORG_TOOL,
    run: (ctx: McpCtx, args) =>
      runGetPartnerOrg(ctx.user.id, args as Parameters<typeof runGetPartnerOrg>[1]),
  },
  {
    def: LIST_PARTNER_APPLICATIONS_TOOL,
    run: (ctx: McpCtx, args) =>
      runListPartnerApplications(
        ctx.user.id,
        args as Parameters<typeof runListPartnerApplications>[1],
      ),
  },
  {
    def: GET_PARTNER_APPLICATION_TOOL,
    run: (ctx: McpCtx, args) =>
      runGetPartnerApplication(
        ctx.user.id,
        args as Parameters<typeof runGetPartnerApplication>[1],
      ),
  },
  {
    def: MANAGE_PARTNER_ORG_TOOL,
    run: (ctx: McpCtx, args) => runManagePartnerOrg(ctx.user.id, args),
  },
  {
    def: MANAGE_PARTNER_MEMBER_TOOL,
    run: (ctx: McpCtx, args) => runManagePartnerMember(ctx.user.id, args),
  },
  {
    def: MANAGE_PARTNER_APPLICATION_TOOL,
    run: (ctx: McpCtx, args) => runManagePartnerApplication(ctx.user.id, args),
  },
  {
    def: MANAGE_PARTNER_PROJECT_LINK_TOOL,
    run: (ctx: McpCtx, args) => runManagePartnerProjectLink(ctx.user.id, args),
  },
  {
    def: PROMOTE_PARTNER_APPLICATION_TOOL,
    run: (ctx: McpCtx, args) =>
      runPromotePartnerApplication(
        ctx.user.id,
        args as Parameters<typeof runPromotePartnerApplication>[1],
      ),
  },
];
