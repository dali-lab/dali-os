// MCP tool: partner_pipeline_report — the funnel + cycle-time aggregation
// from /core/partners/reports (specs/partner-crm.md §12), for one term or all
// time. Scope: mcp:read. Gated to canViewStaffing (Core / Domain Lead).

import { canViewStaffing } from "~/lib/roles";
import { McpForbiddenError, McpInvalidError } from "../../registry";
import {
  resolveReportsTerm,
  loadFunnelSection,
  loadCycleTimeSection,
} from "~/partners/lib/partner-reports.server";

export const PARTNER_PIPELINE_REPORT_TOOL = {
  name: "partner_pipeline_report",
  description:
    "Funnel (counts per stage, conversion New->Interview->Accepted, by source) and cycle time " +
    "(median days Created->Accepted and Created->project) for the partner pipeline, scoped to one " +
    "term or all time. Requires staffing-view access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      termId: {
        type: "string",
        description: "A Term id to scope to. Omit for the lab's current term.",
      },
      allTime: {
        type: "boolean",
        description: "True to ignore any term scoping and report across all applications ever.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runPartnerPipelineReport(
  callerId: string,
  input: { termId?: string; allTime?: boolean },
): Promise<unknown> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner reports");
  }
  if (input.termId && input.allTime) {
    throw new McpInvalidError("Pass either termId or allTime, not both.");
  }

  const termContext = await resolveReportsTerm(input.allTime ? "all" : input.termId ?? null);
  const { selectedTermId, selectedTermCode } = termContext;

  const [funnelSection, cycleTime] = await Promise.all([
    loadFunnelSection(selectedTermId),
    loadCycleTimeSection(selectedTermId),
  ]);

  return {
    termId: selectedTermId,
    termCode: selectedTermCode,
    funnel: funnelSection.funnel,
    bySource: funnelSection.bySource,
    cycleTime,
  };
}
