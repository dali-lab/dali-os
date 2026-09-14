// MCP tool: get_partner_application — get full details of one partner application.
// Scope: mcp:read. Gated to canViewStaffing (Core / Domain Lead).
//
// Mirrors the partners.applications.$id.tsx loader: returns evalRubric,
// interviewRating, ambiguityRating, fundingModel, decisionReason, meetings[],
// source, and assignedMeeterId in addition to the base fields.

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import { McpForbiddenError, McpNotFoundError } from "../../registry";

export const GET_PARTNER_APPLICATION_TOOL = {
  name: "get_partner_application",
  description:
    "Get full details for a partner application. Returns applicant contact, partner org (if promoted), " +
    "target terms, domain scope, eval rubric (8 criteria + interviewRating + notes), acceptance fields " +
    "(ambiguityRating, fundingModel, decisionReason), assigned meeter, source, meetings list, and " +
    "whether a form submission is attached. Requires staffing-view access (Core or Domain Lead).",
  inputSchema: {
    type: "object" as const,
    properties: {
      applicationId: { type: "string", description: "PartnerApplication id." },
    },
    required: ["applicationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runGetPartnerApplication(
  callerId: string,
  input: { applicationId: string },
): Promise<unknown> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner applications");
  }

  const application = await prisma.partnerApplication.findUnique({
    where: { id: input.applicationId },
    select: {
      id: true,
      title: true,
      status: true,
      summary: true,
      sowDocId: true,
      resultingProjectId: true,
      source: true,
      assignedMeeterId: true,
      evalRubric: true,
      interviewRating: true,
      ambiguityRating: true,
      fundingModel: true,
      decisionReason: true,
      partnerOrg: { select: { id: true, name: true } },
      applicantContact: { select: { id: true, name: true, email: true } },
      targetTerms: {
        orderBy: { term: { sortKey: "asc" } },
        select: { termId: true, term: { select: { code: true } } },
      },
      domains: {
        orderBy: { domain: { displayName: "asc" } },
        select: {
          id: true,
          domainId: true,
          expectedMembers: true,
          domain: { select: { displayName: true } },
        },
      },
      formSubmission: { select: { id: true } },
      meetings: {
        orderBy: { scheduledAt: "desc" },
        select: {
          id: true,
          scheduledAt: true,
          attendeeUserIds: true,
          notes: true,
          debrief: true,
          outcome: true,
        },
      },
    },
  });

  if (!application) {
    throw new McpNotFoundError(`Partner application ${input.applicationId} not found`);
  }

  return {
    id: application.id,
    title: application.title,
    status: application.status,
    summary: application.summary,
    source: application.source,
    sowDocId: application.sowDocId,
    resultingProjectId: application.resultingProjectId,
    assignedMeeterId: application.assignedMeeterId,
    evalRubric: application.evalRubric ?? null,
    interviewRating: application.interviewRating ?? null,
    ambiguityRating: application.ambiguityRating ?? null,
    fundingModel: application.fundingModel ?? null,
    decisionReason: application.decisionReason ?? null,
    applicantContact: application.applicantContact
      ? {
          id: application.applicantContact.id,
          name: application.applicantContact.name,
          email: application.applicantContact.email,
        }
      : null,
    // partnerOrg is set only once the application is promoted to a project.
    partner: application.partnerOrg
      ? { id: application.partnerOrg.id, name: application.partnerOrg.name }
      : null,
    targetTerms: application.targetTerms.map((t) => ({
      termId: t.termId,
      code: t.term.code,
    })),
    domains: application.domains.map((d) => ({
      id: d.id,
      domainId: d.domainId,
      domainName: d.domain.displayName,
      expectedMembers: d.expectedMembers,
    })),
    meetings: application.meetings.map((m) => ({
      id: m.id,
      scheduledAt: m.scheduledAt.toISOString(),
      attendeeUserIds: m.attendeeUserIds,
      notes: m.notes ?? null,
      debrief: m.debrief ?? null,
      outcome: m.outcome ?? null,
    })),
    hasFormSubmission: application.formSubmission !== null,
  };
}
