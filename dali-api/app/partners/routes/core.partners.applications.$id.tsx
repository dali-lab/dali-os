import { useState, type ReactNode } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
  useSearchParams,
} from "react-router";
import {
  Pencil,
  Calendar,
  LayoutGrid,
  ClipboardList,
  Info,
  FileText,
  Mail,
} from "lucide-react";
import { SegmentedTabButtons } from "~/components/ui/SegmentedTabs";
import { IconButton } from "~/components/ui/IconButton";
import { Pill } from "~/components/ui/Pill";
import { buttonClasses } from "~/components/ui/Button";
import type { Route } from "./+types/core.partners.applications.$id";
import { prisma } from "~/lib/db.server";
import { BadRequestError, NotFoundError } from "~/lib/http-error";
import { promotePartnerApplication } from "../lib/partner-promote.server";
import { debriefPartnerMeeting, logPartnerMeeting } from "../lib/partner-meetings.server";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getCollabToken } from "~/lib/collab-token.server";
import { isCore } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import {
  PARTNER_STAGE_LABELS as STAGE_LABEL,
  PARTNER_REJECT_REASONS,
  PARTNER_REJECT_REASON_LABELS,
  isPartnerStage,
  isPartnerRejectReason,
} from "../lib/partner-application";
import { PROJECT_FUNDING_TYPES, PROJECT_FUNDING_TYPE_LABELS } from "~/lib/chart-string";
import { formAnswerRows } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { EVAL_CRITERIA, EVAL_CRITERIA_VERSION } from "../lib/discovery-rubric";
import {
  sendTriageNextStepsEmail,
  sendMeetingInviteEmail,
  sendDecisionAcceptedEmail,
  sendDecisionRejectedEmail,
  sendLearnMoreRequestEmail,
} from "../lib/partner-emails.server";
import {
  logPartnerActivity,
  setApplicationStage,
} from "../lib/partner-activity.server";
import { getFrontendUrl } from "~/lib/app-env";
import type { PartnerMeetingOutcome } from "~/generated/prisma/enums";
import { getPartnerContactEmailThreads } from "../lib/partner-email.server";
import {
  partnerContractStatus,
  listPartnerContractDocuments,
  handleContractIntent,
} from "../lib/partner-contract.server";
import { handleSowIntent } from "../lib/partner-finance.server";
import { PropertyRail } from "../components/application/PropertyRail";
import { ProjectIcon } from "~/components/ProjectIcon";
import { postPartnerApplicationIntent } from "../lib/partner-detail-fetch";
import { ProjectIconPicker } from "~/projects/components/ProjectIconPicker";
import { listActiveCoreMembers, resolveApplicationIcon } from "../lib/core-members.server";
import { DetailsLayout, RailGroup, STAGE_TONE } from "../components/application/rail";
import { initialRecordTab, type RecordTab } from "../lib/record-tab";
import { EvaluationTab } from "../components/application/EvaluationTab";
import { ActivityTab } from "../components/application/ActivityTab";
import { EmailTab } from "../components/application/EmailTab";
import { MeetingsTab } from "../components/application/MeetingsTab";
import { StageActions } from "../components/application/StageActions";
import { SowTab } from "../components/application/SowTab";
import { ScheduleInterviewModal } from "../components/ScheduleInterviewModal";

export const meta: Route.MetaFunction = ({ data }) => {
  const a = (data as { application?: { title: string } } | undefined)
    ?.application;
  return [
    {
      title: a
        ? `${a.title} · Partner Applications · DALI OS`
        : "Partner Application · DALI OS",
    },
  ];
};

// The trailing crumb reads the application title off `trailLabel`, set below,
// so the trail is "Core › Partner CRM › <application title>".
export const handle = {
  ...coreHandle("partners", (data) => (data as { trailLabel?: string } | null)?.trailLabel),
  favoriteRoute: true,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const application = await prisma.partnerApplication.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      iconEmoji: true,
      piUserId: true,
      summary: true,
      stage: true,
      sowDocId: true,
      sowState: true,
      resultingProjectId: true,
      continuesProject: { select: { id: true, name: true } },
      source: true,
      evalRubric: true,
      interviewRating: true,
      ambiguityRating: true,
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
        select: { termId: true, term: { select: { code: true } } },
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
        select: {
          answers: true,
          formVersion: { select: { questions: true } },
        },
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
  if (!application) throw new Response("Not found", { status: 404 });

  // The partner's answers to the bound application form (if one was bound
  // when they applied), resolved to label/value pairs for display.
  const formAnswers = application.formSubmission
    ? await formAnswerRows(
        (application.formSubmission.formVersion.questions as unknown as Question[]) ?? [],
        (application.formSubmission.answers as Record<string, unknown>) ?? {},
      )
    : [];

  const [allDomains, terms, canEdit] = await Promise.all([
    prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
    prisma.term.findMany({
      orderBy: { sortKey: "desc" },
      select: { id: true, code: true },
    }),
    isCore(auth.user.sub),
  ]);

  // Domains not yet on this application — offered in the "add scope" picker.
  const usedDomainIds = new Set(application.domains.map((d) => d.domainId));
  const availableDomains = allDomains.filter((d) => !usedDomainIds.has(d.id));

  const collabToken = await getCollabToken(request);
  const userName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
    auth.user.email;

  // Core member list for the meeter / attendee pickers.
  const coreMembers = await listActiveCoreMembers(request);
  const iconEmoji = await resolveApplicationIcon(application);

  // Activity timeline (newest first) + a name map for the acting Core members.
  let activities: {
    id: string;
    createdAt: string;
    applicationId: string | null;
    actorUserId: string | null;
    type: string;
    body: string | null;
    metadata: Record<string, unknown> | null;
  }[] = [];
  let actorNames: Record<string, string> = {};
  const rows = await prisma.partnerActivity.findMany({
    where: { applicationId: params.id },
    orderBy: { createdAt: "desc" },
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
  activities = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    applicationId: r.applicationId,
    actorUserId: r.actorUserId,
    type: r.type,
    body: r.body,
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
  }));
  const actorIds = [
    ...new Set(rows.map((r) => r.actorUserId).filter(Boolean)),
  ] as string[];
  if (actorIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    });
    actorNames = Object.fromEntries(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(" ") ||
          u.daliEmail ||
          u.id,
      ]),
    );
  }

  const emailThreads = await getPartnerContactEmailThreads(application.applicantContact.id);
  const contract = await partnerContractStatus(application.id);
  const contractDocuments = canEdit ? await listPartnerContractDocuments() : [];

  return {
    application: {
      id: application.id,
      title: application.title,
      iconEmoji,
      piUserId: application.piUserId,
      summary: application.summary,
      stage: application.stage,
      sowDocId: application.sowDocId,
      sowState: application.sowState,
      resultingProjectId: application.resultingProjectId,
      continuesProject: application.continuesProject,
      targetTerms: application.targetTerms.map((t) => ({
        termId: t.termId,
        code: t.term.code,
      })),
      partner: application.partnerOrg,
      applicant: application.applicantContact,
      source: application.source,
      evalRubric: application.evalRubric,
      interviewRating: application.interviewRating,
      ambiguityRating: application.ambiguityRating,
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
      domains: application.domains.map((d) => ({
        id: d.id,
        domainId: d.domainId,
        domainName: d.domain.displayName,
        // Legacy ProseMirror scope docs convert to block JSON on read; edits
        // save blocks back to the same column.
        expectedChallenges: ensureBlocks(d.expectedChallenges),
        expectedMembers: d.expectedMembers,
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
    availableDomains,
    terms,
    canEdit,
    collabToken,
    userName,
    coreMembers,
    activities,
    actorNames,
    emailThreads,
    contract,
    contractDocuments,
    trailLabel: application.title,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to edit this application." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "details";

  if (intent === "title") {
    const title = (form.get("title") as string | null)?.trim() ?? "";
    if (!title) return { error: "Title is required." };
    await prisma.partnerApplication.update({
      where: { id: params.id },
      data: { title },
    });
  } else if (intent === "icon") {
    const iconEmoji = (form.get("iconEmoji") as string | null)?.trim() || null;
    const app = await prisma.partnerApplication.findUnique({
      where: { id: params.id },
      select: { resultingProjectId: true },
    });
    if (!app) return { error: "That application no longer exists." };
    if (app.resultingProjectId) {
      await prisma.project.update({ where: { id: app.resultingProjectId }, data: { iconEmoji } });
    } else {
      await prisma.partnerApplication.update({ where: { id: params.id }, data: { iconEmoji } });
    }
  } else if (intent === "pi") {
    const piUserId = (form.get("piUserId") as string | null) || null;
    if (piUserId && !(await isCore(piUserId))) return { error: "A PI must be a Core member." };
    await prisma.partnerApplication.update({ where: { id: params.id }, data: { piUserId } });
  } else if (intent === "stage") {
    const stage = form.get("stage");
    if (!isPartnerStage(stage)) {
      return { error: "Invalid stage." };
    }
    await setApplicationStage(prisma, {
      applicationId: params.id,
      to: stage,
      actorUserId: auth.user.sub,
      request,
    });
  } else if (intent === "details") {
    const summaryRaw = (form.get("summary") as string | null)?.trim() ?? "";
    // The form posts one targetTermId per selected term; blank/duplicate
    // entries are dropped so an empty list cleanly clears all target terms.
    const termIds = [
      ...new Set(
        form
          .getAll("targetTermId")
          .map((v) => String(v).trim())
          .filter(Boolean),
      ),
    ];
    if (termIds.length > 0) {
      const found = await prisma.term.findMany({
        where: { id: { in: termIds } },
        select: { id: true },
      });
      if (found.length !== termIds.length) {
        return { error: "One of those terms no longer exists." };
      }
    }
    // Keep retained join rows: they now own term-specific planning metadata.
    await prisma.$transaction([
      prisma.partnerApplication.update({
        where: { id: params.id },
        data: { summary: summaryRaw === "" ? null : summaryRaw },
      }),
      prisma.partnerApplicationTargetTerm.deleteMany({
        where: { applicationId: params.id, termId: { notIn: termIds } },
      }),
      prisma.partnerApplicationTargetTerm.createMany({
        data: termIds.map((termId) => ({
          applicationId: params.id,
          termId,
        })),
        skipDuplicates: true,
      }),
    ]);
  } else if (intent === "promote") {
    const orgName = form.get("orgName");
    try {
      const result = await promotePartnerApplication({
        applicationId: params.id,
        orgName: typeof orgName === "string" ? orgName : undefined,
        actorUserId: auth.user.sub,
        request,
      });
      return redirect(`/projects/${result.projectId}`);
    } catch (err) {
      if (err instanceof NotFoundError) return { error: "That application no longer exists." };
      if (err instanceof BadRequestError) {
        return { error: "Pick at least one target term before reopening the project." };
      }
      throw err;
    }

  // ─── CRM intents ────────────────────────────────────────────────────────

  } else if (
    intent === "offer-meeting" ||
    intent === "send-application" ||
    intent === "reject" ||
    intent === "learn-more" ||
    intent === "accept" ||
    intent === "eval" ||
    intent === "acceptance" ||
    intent === "meeting-create" ||
    intent === "meeting-debrief" ||
    intent === "note" ||
    intent === "next-step" ||
    intent === "hold" ||
    intent === "deal-terms" ||
    intent === "summary" ||
    intent === "contract-send" ||
    intent === "sow-state"
  ) {
    if (intent === "offer-meeting") {
      const when = (form.get("when") as string | null)?.trim() ?? "";
      const details = (form.get("details") as string | null)?.trim() || undefined;
      if (!when) return { error: "Meeting time is required." };
      const applicant = await prisma.partnerApplication.findUnique({
        where: { id: params.id },
        select: { applicantContact: { select: { name: true, email: true } } },
      });
      await setApplicationStage(prisma, {
        applicationId: params.id,
        to: "Interview",
        actorUserId: auth.user.sub,
        request,
      });
      if (applicant?.applicantContact?.email) {
        await sendMeetingInviteEmail(
          applicant.applicantContact.email,
          applicant.applicantContact.name,
          when,
          details,
        );
        await logPartnerActivity(prisma, {
          applicationId: params.id,
          actorUserId: auth.user.sub,
          type: "EmailSent",
          metadata: { kind: "meeting-invite" },
        });
      }

    } else if (intent === "send-application") {
      const nextSteps =
        (form.get("nextSteps") as string | null)?.trim() ||
        `We'd love to learn more about your project. Please fill out our application at ${getFrontendUrl()}/partner/apply`;
      const applicant = await prisma.partnerApplication.findUnique({
        where: { id: params.id },
        select: { applicantContact: { select: { name: true, email: true } } },
      });
      // No stage change — this just nudges the partner toward the application
      // form. A card can sit in New and get this email more than once.
      if (applicant?.applicantContact?.email) {
        await sendTriageNextStepsEmail(
          applicant.applicantContact.email,
          applicant.applicantContact.name,
          nextSteps + `\n\nApply here: ${getFrontendUrl()}/partner/apply`,
        );
        await logPartnerActivity(prisma, {
          applicationId: params.id,
          actorUserId: auth.user.sub,
          type: "EmailSent",
          metadata: { kind: "next-steps" },
        });
      }

    } else if (intent === "reject") {
      const rejectReason = form.get("rejectReason");
      if (!isPartnerRejectReason(rejectReason)) {
        return { error: "Choose a rejection reason." };
      }
      const reason = (form.get("reason") as string | null)?.trim() || undefined;
      const applicant = await prisma.partnerApplication.findUnique({
        where: { id: params.id },
        select: { applicantContact: { select: { name: true, email: true } } },
      });
      await setApplicationStage(prisma, {
        applicationId: params.id,
        to: "Rejected",
        actorUserId: auth.user.sub,
        request,
        data: { decisionReason: reason ?? null, rejectReason },
        meta: { rejectReason, ...(reason ? { reason } : {}) },
      });
      if (applicant?.applicantContact?.email) {
        await sendDecisionRejectedEmail(
          applicant.applicantContact.email,
          applicant.applicantContact.name,
          reason,
        );
        await logPartnerActivity(prisma, {
          applicationId: params.id,
          actorUserId: auth.user.sub,
          type: "EmailSent",
          metadata: { kind: "rejected" },
        });
      }

    } else if (intent === "learn-more") {
      const whatWeNeed = (form.get("whatWeNeed") as string | null)?.trim() ?? "";
      if (!whatWeNeed) return { error: "Please describe what you need from the partner." };
      const applicant = await prisma.partnerApplication.findUnique({
        where: { id: params.id },
        select: { applicantContact: { select: { name: true, email: true } } },
      });
      // No stage change — "learn more" is a side-request, not a funnel move.
      await prisma.partnerApplication.update({
        where: { id: params.id },
        data: { decisionReason: whatWeNeed },
      });
      if (applicant?.applicantContact?.email) {
        await sendLearnMoreRequestEmail(
          applicant.applicantContact.email,
          applicant.applicantContact.name,
          whatWeNeed,
        );
        await logPartnerActivity(prisma, {
          applicationId: params.id,
          actorUserId: auth.user.sub,
          type: "EmailSent",
          metadata: { kind: "learn-more" },
        });
      }

    } else if (intent === "accept") {
      const app = await prisma.partnerApplication.findUnique({
        where: { id: params.id },
        select: {
          title: true,
          applicantContact: { select: { name: true, email: true } },
        },
      });
      await setApplicationStage(prisma, {
        applicationId: params.id,
        to: "Accepted",
        actorUserId: auth.user.sub,
        request,
      });
      if (app?.applicantContact?.email) {
        await sendDecisionAcceptedEmail(
          app.applicantContact.email,
          app.applicantContact.name,
          app.title,
        );
        await logPartnerActivity(prisma, {
          applicationId: params.id,
          actorUserId: auth.user.sub,
          type: "EmailSent",
          metadata: { kind: "accepted" },
        });
      }

    } else if (intent === "eval") {
      const rubric: Record<string, unknown> = {};
      for (const c of EVAL_CRITERIA) {
        const raw = form.get(`score_${c.key}`);
        if (raw !== null && raw !== "") {
          const n = Number(raw);
          if (Number.isInteger(n) && n >= 1 && n <= 5) rubric[c.key] = n;
        }
      }
      const notes = (form.get("evalNotes") as string | null)?.trim() || undefined;
      if (notes) rubric.notes = notes;
      rubric.criteriaVersion = EVAL_CRITERIA_VERSION;

      const interviewRatingRaw = form.get("interviewRating");
      const interviewRating =
        interviewRatingRaw !== null && interviewRatingRaw !== ""
          ? Math.min(5, Math.max(1, Math.round(Number(interviewRatingRaw))))
          : null;

      await prisma.partnerApplication.update({
        where: { id: params.id },
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          evalRubric: rubric as any,
          ...(interviewRating !== null ? { interviewRating } : {}),
        },
      });
      await logPartnerActivity(prisma, {
        applicationId: params.id,
        actorUserId: auth.user.sub,
        type: "Evaluated",
        ...(interviewRating !== null
          ? { metadata: { interviewRating } }
          : {}),
      });

    } else if (intent === "acceptance") {
      const ambiguityRaw = form.get("ambiguityRating");
      const ambiguityRating =
        ambiguityRaw !== null && ambiguityRaw !== ""
          ? Math.min(5, Math.max(1, Math.round(Number(ambiguityRaw))))
          : null;
      const fundingTypeRaw = form.get("fundingType");
      const fundingType =
        typeof fundingTypeRaw === "string" &&
        (PROJECT_FUNDING_TYPES as readonly string[]).includes(fundingTypeRaw)
          ? (fundingTypeRaw as (typeof PROJECT_FUNDING_TYPES)[number])
          : null;
      await prisma.partnerApplication.update({
        where: { id: params.id },
        data: {
          ...(ambiguityRating !== null ? { ambiguityRating } : {}),
          fundingType,
        },
      });

    } else if (intent === "meeting-create") {
      const dateRaw = (form.get("meetingDate") as string | null)?.trim() ?? "";
      if (!dateRaw) return { error: "Meeting date is required." };
      const scheduledAt = new Date(dateRaw);
      if (isNaN(scheduledAt.getTime())) return { error: "Invalid meeting date." };
      const attendeeUserIds = form
        .getAll("attendeeUserIds")
        .map((v) => String(v).trim())
        .filter(Boolean);
      const notes = (form.get("meetingNotes") as string | null)?.trim() || undefined;

      const app = await prisma.partnerApplication.findUnique({
        where: { id: params.id },
        select: { applicantContact: { select: { name: true, email: true } } },
      });
      try {
        await logPartnerMeeting({
          applicationId: params.id,
          scheduledAt,
          attendeeUserIds,
          notes: notes ?? null,
          actorUserId: auth.user.sub,
        });
      } catch (err) {
        if (err instanceof NotFoundError) return { error: "That application no longer exists." };
        throw err;
      }

      const notifyPartner = form.get("notifyPartner") === "on";
      if (notifyPartner && app?.applicantContact?.email) {
        const when = scheduledAt.toLocaleString("en-US", {
          dateStyle: "long",
          timeStyle: "short",
        });
        await sendMeetingInviteEmail(
          app.applicantContact.email,
          app.applicantContact.name,
          when,
          notes,
        );
        await logPartnerActivity(prisma, {
          applicationId: params.id,
          actorUserId: auth.user.sub,
          type: "EmailSent",
          metadata: { kind: "meeting-invite" },
        });
      }

    } else if (intent === "meeting-debrief") {
      const meetingId = (form.get("meetingId") as string | null)?.trim() ?? "";
      if (!meetingId) return { error: "Meeting ID is required." };
      const debrief = (form.get("debrief") as string | null)?.trim() || null;
      const outcomeRaw = (form.get("outcome") as string | null)?.trim() ?? "";
      const validOutcomes: PartnerMeetingOutcome[] = ["Advance", "Hold", "Reject", "MoreInfoNeeded"];
      const outcome = validOutcomes.includes(outcomeRaw as PartnerMeetingOutcome)
        ? (outcomeRaw as PartnerMeetingOutcome)
        : null;
      try {
        await debriefPartnerMeeting({
          applicationId: params.id,
          meetingId,
          debrief,
          outcome,
          actorUserId: auth.user.sub,
        });
      } catch (err) {
        if (err instanceof NotFoundError) return { error: "That meeting no longer exists." };
        throw err;
      }

    } else if (intent === "note") {
      const body = (form.get("body") as string | null)?.trim() ?? "";
      if (!body) return { error: "Note can't be empty." };
      await logPartnerActivity(prisma, {
        applicationId: params.id,
        actorUserId: auth.user.sub,
        type: "Note",
        body,
      });

    } else if (intent === "next-step") {
      const nextStep = (form.get("nextStep") as string | null)?.trim() ?? "";
      const nextStepDueAtRaw = (form.get("nextStepDueAt") as string | null)?.trim() ?? "";
      const nextStepDueAt = nextStepDueAtRaw ? new Date(nextStepDueAtRaw) : null;
      if (nextStepDueAt && isNaN(nextStepDueAt.getTime())) {
        return { error: "Invalid due date." };
      }
      await prisma.partnerApplication.update({
        where: { id: params.id },
        data: { nextStep: nextStep === "" ? null : nextStep, nextStepDueAt },
      });

    } else if (intent === "hold") {
      const holdUntilRaw = (form.get("holdUntil") as string | null)?.trim() ?? "";
      const holdUntil = holdUntilRaw ? new Date(holdUntilRaw) : null;
      if (holdUntil && isNaN(holdUntil.getTime())) {
        return { error: "Invalid paused-until date." };
      }
      await prisma.partnerApplication.update({
        where: { id: params.id },
        data: { holdUntil },
      });

    } else if (intent === "deal-terms") {
      const fundingTypeRaw = form.get("fundingType");
      const fundingType =
        typeof fundingTypeRaw === "string" &&
        (PROJECT_FUNDING_TYPES as readonly string[]).includes(fundingTypeRaw)
          ? (fundingTypeRaw as (typeof PROJECT_FUNDING_TYPES)[number])
          : null;
      const feeCentsRaw = (form.get("feeCents") as string | null)?.trim() ?? "";
      const feeCents = feeCentsRaw ? Math.max(0, Math.round(Number(feeCentsRaw))) : null;
      if (feeCentsRaw && (feeCents === null || isNaN(feeCents))) {
        return { error: "Invalid fee." };
      }
      const legalEntityName = (form.get("legalEntityName") as string | null)?.trim() || null;
      const legalEntityAddress = (form.get("legalEntityAddress") as string | null)?.trim() || null;
      const paymentSchedule = (form.get("paymentSchedule") as string | null)?.trim() || null;
      await prisma.partnerApplication.update({
        where: { id: params.id },
        data: { fundingType, feeCents, legalEntityName, legalEntityAddress, paymentSchedule },
      });

    } else if (intent === "summary") {
      const summaryRaw = (form.get("summary") as string | null)?.trim() ?? "";
      await prisma.partnerApplication.update({
        where: { id: params.id },
        data: { summary: summaryRaw === "" ? null : summaryRaw },
      });

    } else if (intent === "contract-send") {
      const result = await handleContractIntent(form, {
        applicationId: params.id,
        actorUserId: auth.user.sub,
      });
      if ("error" in result) return { error: result.error };

    } else if (intent === "sow-state") {
      const result = await handleSowIntent(form, {
        applicationId: params.id,
        actorUserId: auth.user.sub,
      });
      if ("error" in result) return { error: result.error };
    }

  } else {
    return { error: "Unknown action." };
  }
  return redirect(`/core/partners/applications/${params.id}`);
}

// loader returns redirect() (a Response) on auth-fail branches; the component
// only renders on the data branch, so narrow it out.
type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;

export default function PartnerApplicationDetail() {
  const {
    application,
    formAnswers,
    availableDomains,
    terms,
    canEdit: canEditPerm,
    collabToken,
    userName,
    coreMembers,
    activities,
    actorNames,
    emailThreads,
    contract,
    contractDocuments,
  } = useLoaderData() as LoaderData;
  // Always-inline editing (gated only by permission), matching the rest of the
  // site — no view/edit mode toggle.
  const canEdit = canEditPerm;
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const refresh = () => revalidator.revalidate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<RecordTab>(() => initialRecordTab(searchParams.get("tab")));
  const [showScheduler, setShowScheduler] = useState(false);

  const topBar = actionData?.error ? (
    <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
      {actionData.error}
    </div>
  ) : null;

  const header = <Header application={application} canEdit={canEdit} />;
  const details = (
    <DetailsSection application={application} canEdit={canEdit} />
  );
  // CRM working sections (only meaningful with edit permission). StageActions
  // is the same stage-aware footer the modal uses (specs/partner-crm.md §5) —
  // it also covers the Accepted-stage "Create project" action, so there is no
  // separate promote block here any more.
  const stageActions = canEdit ? (
    <StageActions
      application={application}
      canEdit={canEdit}
      onOpenSchedule={() => setShowScheduler(true)}
      onChanged={refresh}
    />
  ) : null;
  const evaluation = canEdit ? (
    <EvaluationTab
      applicationId={application.id}
      evalRubric={application.evalRubric}
      interviewRating={application.interviewRating}
      canEdit={canEdit}
      onChanged={refresh}
    />
  ) : null;
  const meetings = canEdit ? (
    <MeetingsTab
      applicationId={application.id}
      meetings={application.meetings}
      meetingRequests={application.meetingRequests}
      coreMembers={coreMembers}
      canEdit={canEdit}
      onScheduleMeeting={() => setShowScheduler(true)}
      onChanged={refresh}
    />
  ) : null;
  const answers =
    formAnswers.length > 0 ? (
      <RailGroup title="Answers">
        <div className="flex flex-col gap-3">
          {formAnswers.map((row) => (
            <div key={row.key}>
              <p className="mb-0.5 text-sm text-os-grey">{row.label}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{row.value || "—"}</p>
            </div>
          ))}
        </div>
      </RailGroup>
    ) : null;
  const domainScope = <DomainScopeBlock domains={application.domains} canEdit={canEdit} />;
  const sow = (
    <SowTab
      applicationId={application.id}
      sowState={application.sowState}
      canEdit={canEdit}
      collabToken={collabToken}
      userName={userName}
      onChanged={refresh}
    />
  );

  // Tabbed record (CRM convention): a top band holds identity + the stage
  // stepper + advance/triage actions (always visible), and the body is tabbed
  // so each heavy section gets full width. Overview (activity feed + key
  // details) is the default, front-and-center, like every CRM record page.
  const activityFeed = (
    <ActivityTab
      applicationId={application.id}
      activities={activities}
      actorNames={actorNames}
      emailThreads={emailThreads}
      canEdit={canEdit}
      onChanged={refresh}
    />
  );

  const propertyRail = (
    <PropertyRail
      application={{
        id: application.id,
        stage: application.stage,
        applicant: application.applicant,
        partner: application.partner,
        resultingProjectId: application.resultingProjectId,
        piUserId: application.piUserId,
        source: application.source,
        nextStep: application.nextStep,
        nextStepDueAt: application.nextStepDueAt,
        holdUntil: application.holdUntil,
        // This loader keys target terms {termId, code}; the rail keys them {id, code}.
        targetTerms: application.targetTerms.map((t) => ({ id: t.termId, code: t.code })),
        summary: application.summary,
        domains: application.domains,
        fundingType: application.fundingType,
        feeCents: application.feeCents,
        legalEntityName: application.legalEntityName,
        legalEntityAddress: application.legalEntityAddress,
        paymentSchedule: application.paymentSchedule,
        sowState: application.sowState,
        contractBindingId: application.contractBindingId,
      }}
      canEdit={canEdit}
      domainOptions={availableDomains.map((d) => ({ id: d.id, name: d.displayName }))}
      termOptions={terms.map((t) => ({ id: t.id, code: t.code }))}
      contract={contract}
      contractDocuments={contractDocuments}
      coreMembers={coreMembers}
      onChanged={refresh}
    />
  );

  const emailTab = (
    <EmailTab contactId={application.applicant?.id ?? ""} threads={emailThreads} />
  );

  const TABS = [
    { key: "overview", label: "Overview", icon: LayoutGrid },
    { key: "evaluation", label: "Evaluation", icon: ClipboardList },
    { key: "meetings", label: "Meetings", icon: Calendar },
    { key: "details", label: "Details", icon: Info },
    { key: "sow", label: "Statement of work", icon: FileText },
    { key: "email", label: "Email", icon: Mail },
  ] as const;

  return (
    <>
    <div className="flex flex-col gap-6">
      {topBar}

      <div className="flex flex-wrap items-start justify-between gap-4">
        {header}
        {stageActions}
      </div>

      <SegmentedTabButtons
        label="Record sections"
        className="self-start"
        items={TABS.map((t) => ({
          label: t.label,
          icon: t.icon,
          active: tab === t.key,
          onClick: () => setTab(t.key),
        }))}
      />

      {tab === "overview" && activityFeed}
      {tab === "evaluation" &&
        (evaluation ?? (
          <p className="text-sm text-muted-foreground">
            You don't have permission to evaluate this application.
          </p>
        ))}
      {tab === "meetings" &&
        (meetings ?? (
          <p className="text-sm text-muted-foreground">
            You don't have permission to log meetings.
          </p>
        ))}
      {tab === "details" && (
        <div className="rounded-os-card bg-os-card p-5">
          <DetailsLayout>
            {propertyRail}
            {details}
            {domainScope}
            {answers}
          </DetailsLayout>
        </div>
      )}
      {tab === "sow" && sow}
      {tab === "email" && emailTab}
    </div>
    {showScheduler && (
      <ScheduleInterviewModal
        applicationId={application.id}
        partnerName={application.applicant.name}
        partnerEmail={application.applicant.email}
        onClose={() => setShowScheduler(false)}
        onScheduled={() => {
          setShowScheduler(false);
          refresh();
        }}
      />
    )}
    </>
  );
}


// ─── Existing components (unchanged below) ────────────────────────────────────

function Header({
  application,
  canEdit,
}: {
  application: LoaderData["application"];
  canEdit: boolean;
}) {
  const revalidator = useRevalidator();
  const [editing, setEditing] = useState(false);

  return (
    <header className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        {editing ? (
          <Form
            method="post"
            onSubmit={() => setEditing(false)}
            className="flex items-center gap-2"
          >
            <input type="hidden" name="intent" value="title" />
            <input
              name="title"
              defaultValue={application.title}
              autoFocus
              aria-label="Application title"
              className="font-heading text-xl font-bold text-foreground px-2 py-1 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-os-accent/30"
            />
            <button type="submit" className={buttonClasses("primary", "sm")}>
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={buttonClasses("secondary", "sm")}
            >
              Cancel
            </button>
          </Form>
        ) : (
          <>
            {canEdit ? (
              <ProjectIconPicker
                iconEmoji={application.iconEmoji}
                editing
                onChange={(emoji) => {
                  void postPartnerApplicationIntent(application.id, "icon", { iconEmoji: emoji }).then(() => revalidator.revalidate());
                }}
              />
            ) : (
              application.iconEmoji && <ProjectIcon iconEmoji={application.iconEmoji} size="lg" />
            )}
            <h1 className="font-heading text-4xl text-foreground">{application.title}</h1>
            {canEdit && (
              <IconButton label="Edit title" icon={Pencil} onClick={() => setEditing(true)} />
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-os-grey">
        <Pill dot={STAGE_TONE[application.stage]}>{STAGE_LABEL[application.stage]}</Pill>
        <span className="min-w-0">
          {application.applicant?.name ?? "Unknown applicant"}
          {application.partner && (
            <>
              {" · "}
              <Link to={`/core/partners/orgs/${application.partner.id}`} className="text-os-accent hover:underline">
                {application.partner.name}
              </Link>
            </>
          )}
        </span>
      </div>
    </header>
  );
}

function DetailsSection({
  application,
  canEdit,
}: {
  application: LoaderData["application"];
  canEdit: boolean;
}) {
  return (
    <RailGroup title="Summary">
    <Form method="post" className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="details" />
      {/* The details intent replaces the term set wholesale, so the terms the
          rail owns ride along unchanged or saving the summary would clear them. */}
      {application.targetTerms.map((t) => (
        <input key={t.termId} type="hidden" name="targetTermId" value={t.termId} />
      ))}

      {/* Core-written synopsis — partners never see or set this (their prose
          lives in the application answers). Hidden in read mode when empty
          so partner-submitted applications don't render a blank row. */}
      {(canEdit || application.summary !== null) && (
        canEdit ? (
          <textarea
            name="summary"
            rows={3}
            defaultValue={application.summary ?? ""}
            aria-label="Internal summary"
            placeholder="A short synopsis for the lab. Partners don't see this."
            className="w-full"
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-foreground">{application.summary}</p>
        )
      )}

      {canEdit && (
        <div className="flex justify-end">
          <button
            type="submit"
            className={buttonClasses("primary", "sm")}
          >
            Save changes
          </button>
        </div>
      )}
    </Form>
    </RailGroup>
  );
}

// Team size, adding and removing domains live in the property rail; this block
// only holds what the rail has no room for, the scope text per domain.
function DomainScopeBlock({
  domains,
  canEdit,
}: {
  domains: LoaderData["application"]["domains"];
  canEdit: boolean;
}) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  async function save(d: LoaderData["application"]["domains"][number], challenges: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partner-application-domains/${d.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedMembers: d.expectedMembers, expectedChallenges: challenges }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Request failed: ${res.status}`);
      }
      setEditId(null);
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (domains.length === 0) return null;

  return (
    <RailGroup title="Domain scope">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col divide-y divide-os-container">
        {domains.map((d) =>
          editId === d.id ? (
            <DomainScopeEditRow key={d.id} row={d} busy={busy} onCancel={() => setEditId(null)} onSave={(c) => void save(d, c)} />
          ) : (
            <div key={d.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">{d.domainName}</span>
                {!isEmptyBlocks(d.expectedChallenges) ? (
                  <DocEditor
                    key={d.id}
                    features="notes"
                    density="compact"
                    editable={false}
                    initialContent={d.expectedChallenges}
                    className="mt-1 text-sm text-os-grey"
                  />
                ) : (
                  <p className="mt-1 text-sm text-os-grey">Not described yet</p>
                )}
              </div>
              {canEdit && <IconButton label={`Edit ${d.domainName}`} icon={Pencil} onClick={() => setEditId(d.id)} />}
            </div>
          ),
        )}
      </div>
    </RailGroup>
  );
}

function DomainScopeEditRow({
  row,
  busy,
  onCancel,
  onSave,
}: {
  row: LoaderData["application"]["domains"][number];
  busy: boolean;
  onCancel: () => void;
  onSave: (expectedChallenges: unknown) => void;
}) {
  const [challenges, setChallenges] = useState<unknown>(row.expectedChallenges);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(isEmptyBlocks(challenges) ? null : challenges);
      }}
      className="flex flex-col gap-2 py-3"
    >
      <span className="text-sm font-medium text-foreground">{row.domainName}</span>
      <DocEditor
        features="notes"
        density="compact"
        initialContent={row.expectedChallenges}
        onChange={setChallenges}
        placeholder="What should this domain deliver?"
        className="rounded-xl border bg-os-card py-2"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonClasses("secondary", "sm")}>
          Cancel
        </button>
        <button type="submit" disabled={busy} className={buttonClasses("primary", "sm")}>
          Save
        </button>
      </div>
    </form>
  );
}

