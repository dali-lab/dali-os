import type { Route } from "./+types/api.partner-applications.$id";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore, getUserRoles, getActiveCoreCycleTermIds } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { withCors, handlePreflight } from "~/lib/cors";
import { formAnswerRows } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import { getPartnerContactEmailThreads } from "../lib/partner-email.server";
import { partnerContractStatus, listPartnerContractDocuments } from "../lib/partner-contract.server";

// GET /api/partner-applications/:id
//
// Everything PartnerApplicationModal's tabs need in one request, loaded when
// the modal opens (the board route's own loader only returns the lightweight
// PartnerCardModel[] the board renders). isCore, same as every other partner
// write endpoint — this one just reads.

const FORM_ANSWER_PREVIEW = 8;
const ACTIVITY_LIMIT = 25;

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const canEdit = await isCore(auth.user.sub);
  if (!canEdit) {
    return forbidden(request);
  }

  const application = await prisma.partnerApplication.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      summary: true,
      stage: true,
      sowDocId: true,
      sowState: true,
      resultingProjectId: true,
      source: true,
      evalRubric: true,
      interviewRating: true,
      nextStep: true,
      nextStepDueAt: true,
      holdUntil: true,
      fundingType: true,
      feeCents: true,
      legalEntityName: true,
      legalEntityAddress: true,
      paymentSchedule: true,
      contractBindingId: true,
      decisionReason: true,
      rejectReason: true,
      partnerOrg: { select: { id: true, name: true, logoUrl: true } },
      applicantContact: { select: { id: true, name: true, email: true } },
      targetTerms: {
        orderBy: { term: { sortKey: "asc" } },
        select: { termId: true, term: { select: { id: true, code: true } } },
      },
      domains: {
        orderBy: { domain: { displayName: "asc" } },
        select: {
          id: true,
          domainId: true,
          expectedChallenges: true,
          expectedMembers: true,
          domain: { select: { displayName: true } },
        },
      },
      formSubmission: {
        select: { answers: true, formVersion: { select: { questions: true } } },
      },
      meetings: {
        orderBy: { scheduledAt: "desc" },
        select: {
          id: true,
          scheduledAt: true,
          attendeeUserIds: true,
          notes: true,
          debrief: true,
          outcome: true,
          scheduledMeeting: { select: { id: true, selectedAt: true, meetingUrl: true } },
        },
      },
      meetingRequests: {
        where: { status: { in: ["Pending", "Declined"] } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          startTime: true,
          durationMinutes: true,
          note: true,
          status: true,
          responseNote: true,
          createdAt: true,
        },
      },
    },
  });
  if (!application) {
    return withCors(request, Response.json({ error: "Application not found" }, { status: 404 }));
  }

  const formAnswers = application.formSubmission
    ? (
        await formAnswerRows(
          (application.formSubmission.formVersion.questions as unknown as Question[]) ?? [],
          (application.formSubmission.answers as Record<string, unknown>) ?? {},
        )
      ).slice(0, FORM_ANSWER_PREVIEW)
    : [];

  const rows = await prisma.partnerActivity.findMany({
    where: { applicationId: params.id },
    orderBy: { createdAt: "desc" },
    take: ACTIVITY_LIMIT,
    select: {
      id: true,
      createdAt: true,
      applicationId: true,
      actorUserId: true,
      type: true,
      body: true,
      metadata: true,
    },
  });
  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
  const actorUsers = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, firstName: true, lastName: true, daliEmail: true },
      })
    : [];
  const actorNames = Object.fromEntries(
    actorUsers.map((u) => [
      u.id,
      [u.firstName, u.lastName].filter(Boolean).join(" ") || u.daliEmail || u.id,
    ]),
  );

  const roles = await getUserRoles(auth.user.sub, request);
  const partnerEmailOn = await isFeatureEnabled("partner-email", auth.user.sub, roles, request);
  const financeOn = await isFeatureEnabled("partner-finance", auth.user.sub, roles, request);
  const emailThreads = partnerEmailOn
    ? await getPartnerContactEmailThreads(application.applicantContact.id)
    : [];
  const contract = await partnerContractStatus(application.id);
  const contractDocuments = canEdit ? await listPartnerContractDocuments() : [];

  // Attendee picker for the Meetings tab's manual "log a meeting" form —
  // mirrors the full page's loader (core.partners.applications.$id.tsx).
  let coreMembers: { userId: string; name: string }[] = [];
  const cycleTermIds = await getActiveCoreCycleTermIds(request);
  if (cycleTermIds.length > 0) {
    const assignments = await prisma.coreAssignment.findMany({
      where: { termId: { in: cycleTermIds } },
      select: {
        userId: true,
        user: { select: { firstName: true, lastName: true, daliEmail: true } },
      },
      distinct: ["userId"],
    });
    coreMembers = assignments.map((a) => ({
      userId: a.userId,
      name:
        [a.user.firstName, a.user.lastName].filter(Boolean).join(" ") ||
        a.user.daliEmail ||
        a.userId,
    }));
    coreMembers.sort((a, b) => a.name.localeCompare(b.name));
  }

  return withCors(
    request,
    Response.json({
      application: {
        id: application.id,
        title: application.title,
        summary: application.summary,
        stage: application.stage,
        sowDocId: application.sowDocId,
        sowState: application.sowState,
        resultingProjectId: application.resultingProjectId,
        source: application.source,
        evalRubric: application.evalRubric,
        interviewRating: application.interviewRating,
        nextStep: application.nextStep,
        nextStepDueAt: application.nextStepDueAt?.toISOString() ?? null,
        holdUntil: application.holdUntil?.toISOString() ?? null,
        fundingType: application.fundingType,
        feeCents: application.feeCents,
        legalEntityName: application.legalEntityName,
        legalEntityAddress: application.legalEntityAddress,
        paymentSchedule: application.paymentSchedule,
        contractBindingId: application.contractBindingId,
        decisionReason: application.decisionReason,
        rejectReason: application.rejectReason,
        partner: application.partnerOrg,
        applicant: application.applicantContact,
        targetTerms: application.targetTerms.map((t) => ({
          id: t.term.id,
          code: t.term.code,
        })),
        domains: application.domains.map((d) => ({
          id: d.id,
          domainId: d.domainId,
          domainName: d.domain.displayName,
          expectedMembers: d.expectedMembers,
          expectedChallenges: d.expectedChallenges,
        })),
        meetings: application.meetings.map((m) => ({
          id: m.id,
          scheduledAt: m.scheduledAt.toISOString(),
          attendeeUserIds: m.attendeeUserIds,
          notes: m.notes,
          debrief: m.debrief,
          outcome: m.outcome,
          scheduledMeeting: m.scheduledMeeting
            ? {
                id: m.scheduledMeeting.id,
                startTime: m.scheduledMeeting.selectedAt?.toISOString() ?? null,
                meetingUrl: m.scheduledMeeting.meetingUrl,
              }
            : null,
        })),
        meetingRequests: application.meetingRequests.map((r) => ({
          id: r.id,
          startTime: r.startTime.toISOString(),
          durationMinutes: r.durationMinutes,
          note: r.note,
          status: r.status,
          responseNote: r.responseNote,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      formAnswers,
      activities: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        applicationId: r.applicationId,
        actorUserId: r.actorUserId,
        type: r.type,
        body: r.body,
        metadata: (r.metadata ?? null) as Record<string, unknown> | null,
      })),
      actorNames,
      emailThreads,
      partnerEmailOn,
      financeOn,
      contract,
      contractDocuments,
      coreMembers,
    }),
  );
}
