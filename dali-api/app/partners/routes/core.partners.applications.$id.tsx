import { useState, type ReactNode } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
  useSubmit,
} from "react-router";
import { Select, type SelectOption } from "~/components/ui/floating";
import {
  Pencil,
  Calendar,
  LayoutGrid,
  ClipboardList,
  Info,
  FileText,
  Mail,
} from "lucide-react";
import { UnderlineTabButtons } from "~/components/AreaPillNav";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import type { Route } from "./+types/core.partners.applications.$id";
import { prisma } from "~/lib/db";
import { githubTeamSlug } from "~/lib/github-slug";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getCollabToken } from "~/lib/collab-token.server";
import { isCore, getActiveCoreCycleTermIds } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import {
  PARTNER_STAGES as STAGES,
  PARTNER_STAGE_LABELS as STAGE_LABEL,
  PARTNER_REJECT_REASONS,
  PARTNER_REJECT_REASON_LABELS,
  isPartnerStage,
  isPartnerRejectReason,
  type PartnerStage as Status,
} from "../lib/partner-application";
import { PROJECT_FUNDING_TYPES, PROJECT_FUNDING_TYPE_LABELS } from "~/lib/chart-string";
import { formAnswerRows } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { isEmptyBlocks } from "~/lib/blocks";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { useDialog } from "~/components/ui/dialog";
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
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getPartnerContactEmailThreads } from "../lib/partner-email.server";
import {
  partnerContractStatus,
  listPartnerContractDocuments,
  handleContractIntent,
} from "../lib/partner-contract.server";
import { handleSowIntent } from "../lib/partner-finance.server";
import { PropertyRail } from "../components/application/PropertyRail";
import { EvaluationTab } from "../components/application/EvaluationTab";
import { ActivityTab } from "../components/application/ActivityTab";
import { EmailTab } from "../components/application/EmailTab";
import { MeetingsTab } from "../components/application/MeetingsTab";
import { StageActions } from "../components/application/StageActions";
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
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

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

  const roles = await getUserRoles(auth.user.sub, request);
  const partnerEmailOn = await isFeatureEnabled("partner-email", auth.user.sub, roles, request);
  const financeOn = await isFeatureEnabled("partner-finance", auth.user.sub, roles, request);
  const emailThreads = partnerEmailOn
    ? await getPartnerContactEmailThreads(application.applicantContact.id)
    : [];
  const contract = await partnerContractStatus(application.id);
  const contractDocuments = canEdit ? await listPartnerContractDocuments() : [];

  return {
    application: {
      id: application.id,
      title: application.title,
      summary: application.summary,
      stage: application.stage,
      sowDocId: application.sowDocId,
      sowState: application.sowState,
      resultingProjectId: application.resultingProjectId,
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
    partnerEmailOn,
    financeOn,
    contract,
    contractDocuments,
    trailLabel: application.title,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
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
  } else if (intent === "stage") {
    const stage = form.get("stage");
    if (!isPartnerStage(stage)) {
      return { error: "Invalid stage." };
    }
    await setApplicationStage(prisma, {
      applicationId: params.id,
      to: stage,
      actorUserId: auth.user.sub,
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
    // Replace the whole target-term set in one transaction: scalar fields,
    // then drop and recreate the join rows.
    await prisma.$transaction([
      prisma.partnerApplication.update({
        where: { id: params.id },
        data: { summary: summaryRaw === "" ? null : summaryRaw },
      }),
      prisma.partnerApplicationTargetTerm.deleteMany({
        where: { applicationId: params.id },
      }),
      prisma.partnerApplicationTargetTerm.createMany({
        data: termIds.map((termId) => ({
          applicationId: params.id,
          termId,
        })),
      }),
    ]);
  } else if (intent === "promote") {
    // Spin up a Project from this application and link the two so they share
    // partner + scope data. Idempotent on resultingProjectId so a double
    // submit can't create two projects.
    const app = await prisma.partnerApplication.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        summary: true,
        resultingProjectId: true,
        partnerOrgId: true,
        applicantContactId: true,
        applicantContact: { select: { name: true } },
        targetTerms: {
          orderBy: { term: { sortKey: "asc" } },
          select: { termId: true },
        },
        domains: {
          select: { domainId: true, expectedMembers: true },
        },
      },
    });
    if (!app) return { error: "That application no longer exists." };
    const promoteOrgName =
      typeof form.get("orgName") === "string"
        ? (form.get("orgName") as string).trim()
        : "";
    if (app.resultingProjectId) {
      return redirect(`/projects/${app.resultingProjectId}`);
    }

    // Earliest target term (targetTerms is sorted by sortKey asc) seeds the
    // project's term set and scopes the per-domain role requests. Without a
    // target term we still create the project, just with no terms and no role
    // requests (ProjectRoleRequest requires a termId).
    const firstTermId = app.targetTerms[0]?.termId ?? null;
    // PartnerApplicationDomain carries headcount but no level; new role
    // requests default to P1 (Learner) — the staffing board can refine.
    const roleRequestRows = firstTermId
      ? app.domains
          .filter((d) => d.expectedMembers > 0)
          .map((d) => ({
            termId: firstTermId,
            domainId: d.domainId,
            level: "P1" as const,
            slots: d.expectedMembers,
          }))
      : [];
    // The project's declared domains are INHERITED from the role requests: the
    // distinct domains the project needs people in. No role requests → no
    // domains inherited. After promotion these stay editable the usual way
    // (the `domains` intent on the project page), so this is just the initial
    // seed, not a binding.
    const inheritedDomainIds = Array.from(
      new Set(roleRequestRows.map((r) => r.domainId)),
    );

    const project = await prisma.$transaction(async (tx) => {
      // Account-first: the PartnerOrg is created HERE (org-at-promotion).
      // Legacy applications already carry a partnerOrgId; account-first ones
      // spin up the org from the applicant contact, who becomes its first
      // member. Core can name the org on the promote form; otherwise it's an
      // individual partner named after the applicant.
      let orgId = app.partnerOrgId;
      if (!orgId) {
        const org = await tx.partnerOrg.create({
          data: {
            name: promoteOrgName || app.applicantContact?.name || app.title,
            isIndividual: !promoteOrgName,
          },
          select: { id: true },
        });
        const membership = await tx.partnerMembership.create({
          data: { contactId: app.applicantContactId, orgId: org.id },
          select: { id: true },
        });
        await tx.partnerOrg.update({
          where: { id: org.id },
          data: { primaryContactId: membership.id },
        });
        orgId = org.id;
      }

      const created = await tx.project.create({
        data: {
          name: app.title,
          // Auto-derive the GitHub team slug from the title (editable later).
          githubTeamSlug: githubTeamSlug(app.title) || null,
          description: app.summary,
          ...(firstTermId
            ? { projectTerms: { create: { termId: firstTermId } } }
            : {}),
          partners: { create: { partnerOrgId: orgId } },
          ...(roleRequestRows.length > 0
            ? { roleRequests: { create: roleRequestRows } }
            : {}),
          ...(inheritedDomainIds.length > 0
            ? {
                domains: {
                  create: inheritedDomainIds.map((domainId) => ({ domainId })),
                },
              }
            : {}),
        },
        select: { id: true },
      });
      // "Promoted" is derived (stage Accepted + resultingProjectId), not a
      // stage of its own — the move here is a no-op if already Accepted, but
      // still worth routing through setApplicationStage for the resultingProjectId
      // write and so a reject-then-promote edge case can't skip the activity log.
      await setApplicationStage(tx, {
        applicationId: app.id,
        to: "Accepted",
        actorUserId: auth.user.sub,
        data: { resultingProjectId: created.id, partnerOrgId: orgId },
        meta: { projectId: created.id },
      });
      return created;
    });
    return redirect(`/projects/${project.id}`);

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

      // Fetch the applicant contact id
      const app = await prisma.partnerApplication.findUnique({
        where: { id: params.id },
        select: { applicantContactId: true, applicantContact: { select: { name: true, email: true } } },
      });

      const meeting = await prisma.partnerMeeting.create({
        data: {
          applicationId: params.id,
          scheduledAt,
          attendeeUserIds,
          notes: notes ?? null,
          contactId: app?.applicantContactId ?? null,
        },
        select: { id: true },
      });
      await logPartnerActivity(prisma, {
        applicationId: params.id,
        actorUserId: auth.user.sub,
        type: "MeetingScheduled",
        metadata: { meetingId: meeting.id, scheduledAt: scheduledAt.toISOString() },
      });

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
      await prisma.partnerMeeting.update({
        where: { id: meetingId },
        data: {
          debrief,
          ...(outcome ? { outcome } : {}),
        },
      });
      await logPartnerActivity(prisma, {
        applicationId: params.id,
        actorUserId: auth.user.sub,
        type: "MeetingDebriefed",
        metadata: { meetingId, ...(outcome ? { outcome } : {}) },
      });

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
    partnerEmailOn,
    financeOn,
    contract,
    contractDocuments,
  } = useLoaderData() as LoaderData;
  // Always-inline editing (gated only by permission), matching the rest of the
  // site — no view/edit mode toggle.
  const canEdit = canEditPerm;
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const refresh = () => revalidator.revalidate();
  const [tab, setTab] = useState<
    "overview" | "evaluation" | "meetings" | "details" | "sow" | "email"
  >("overview");
  const [showScheduler, setShowScheduler] = useState(false);

  const topBar = actionData?.error ? (
    <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
      {actionData.error}
    </div>
  ) : null;

  const header = <Header application={application} canEdit={canEdit} />;
  const details = (
    <DetailsSection application={application} terms={terms} canEdit={canEdit} />
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
      <section className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Application answers
        </h2>
        <dl className="flex flex-col gap-3">
          {formAnswers.map((row) => (
            <div key={row.key}>
              <dt className="text-xs font-medium text-muted-foreground mb-0.5">
                {row.label}
              </dt>
              <dd className="text-sm text-foreground whitespace-pre-wrap">
                {row.value || "—"}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    ) : null;
  const domainScope = (
    <DomainScopeBlock
      applicationId={application.id}
      domains={application.domains}
      availableDomains={availableDomains}
      canEdit={canEdit}
    />
  );
  const sow = (
    <SowBlock
      applicationId={application.id}
      canEdit={canEdit}
      collabToken={collabToken}
      userName={userName}
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
      emailThreads={partnerEmailOn ? emailThreads : []}
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
        source: application.source,
        nextStep: application.nextStep,
        nextStepDueAt: application.nextStepDueAt,
        holdUntil: application.holdUntil,
        // This file's target terms are {termId, code} (TargetTermsField below
        // reads `.termId`); the rail's shared type keys them {id, code}.
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
      financeOn={financeOn}
      onChanged={refresh}
    />
  );

  const emailTab = (
    <EmailTab contactId={application.applicant?.id ?? ""} threads={emailThreads} partnerEmailOn={partnerEmailOn} />
  );

  const TABS = [
    { key: "overview", label: "Overview", icon: LayoutGrid },
    { key: "evaluation", label: "Evaluation", icon: ClipboardList },
    { key: "meetings", label: "Meetings", icon: Calendar },
    { key: "details", label: "Details", icon: Info },
    { key: "sow", label: "Statement of Work", icon: FileText },
    { key: "email", label: "Email", icon: Mail },
  ] as const;

  return (
    <>
    <div className="flex flex-col gap-4">
      {topBar}

      {/* Top band — identity, stage progression, and triage/advance actions,
          always visible above the tabs. */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        {header}
        <StageStepper stage={application.stage} />
        {stageActions}
      </div>

      <UnderlineTabButtons
        label="Record sections"
        items={TABS.map((t) => ({
          label: t.label,
          icon: t.icon,
          active: tab === t.key,
          onClick: () => setTab(t.key),
        }))}
      />

      {tab === "overview" && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">{activityFeed}</div>
          {propertyRail}
        </div>
      )}
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
        <div className="flex flex-col gap-4">
          {details}
          {domainScope}
          {answers}
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


// ─── CRM: Triage / decision bar ────────────────────────────────────────────────

// Happy-path funnel order for the stepper + the sequential "advance" CTA.
// Rejected is the off-ramp and sits off this main line.
const FUNNEL_ORDER = ["New", "Interview", "Accepted"] as const;

// Rejected can happen from New or Interview; anchor its stepper position at
// Interview so the chip reads as "got this far, then rejected" rather than
// resetting to the start.
const REJECTED_ANCHOR_IDX = FUNNEL_ORDER.indexOf("Interview");

function StageStepper({ stage }: { stage: Status }) {
  const onPath = (FUNNEL_ORDER as readonly string[]).includes(stage);
  const currentIdx = onPath
    ? FUNNEL_ORDER.indexOf(stage as (typeof FUNNEL_ORDER)[number])
    : REJECTED_ANCHOR_IDX;
  return (
    <ol className="flex flex-wrap items-center gap-1">
      {FUNNEL_ORDER.map((s, i) => {
        const done = i < currentIdx;
        const current = i === currentIdx && onPath;
        return (
          <li key={s} className="flex items-center gap-1">
            <span
              className={cn(
                "text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap",
                current
                  ? "bg-accent-coral text-white border-accent-coral"
                  : done
                    ? "bg-accent-coral/10 text-accent-coral border-accent-coral/20"
                    : "bg-muted/40 text-muted-foreground border-border",
              )}
            >
              {STAGE_LABEL[s]}
            </span>
            {i < FUNNEL_ORDER.length - 1 && (
              <span className="text-muted-foreground/40 text-[10px]">›</span>
            )}
          </li>
        );
      })}
      {stage === "Rejected" && (
        <li className="ml-1 text-[11px] px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/20">
          Rejected
        </li>
      )}
    </ol>
  );
}

// ─── Existing components (unchanged below) ────────────────────────────────────

// Decision stages that silently skip the email pipeline — selecting either of
// these via the dropdown should warn that no email is sent.
const SILENT_DECISION_STAGES = new Set<Status>(["Accepted", "Rejected"]);

function Header({
  application,
  canEdit,
}: {
  application: LoaderData["application"];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const submit = useSubmit();
  const dialog = useDialog();

  const handleStageChange = async (value: string) => {
    const toStage = value as Status;
    if (SILENT_DECISION_STAGES.has(toStage)) {
      const ok = await dialog.confirm({
        title: `Move to "${STAGE_LABEL[toStage]}"?`,
        description:
          "This does NOT email the partner. Use the Accept/Reject buttons to notify them.",
        confirmLabel: "Move anyway",
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set("intent", "stage");
    fd.set("stage", value);
    submit(fd, { method: "post" });
  };

  return (
    <header className="flex flex-col gap-2">
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
              className="font-heading text-xl font-bold text-foreground px-2 py-1 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
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
            <h1 className="font-heading text-2xl font-bold text-foreground">
              {application.title}
            </h1>
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Edit title"
                title="Edit title"
                className="text-muted-foreground hover:text-accent-coral transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}

        {canEdit ? (
          <Select
            name="stage"
            defaultValue={application.stage}
            ariaLabel="Application stage"
            onChange={handleStageChange}
            options={STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
            buttonClassName="text-xs px-2 py-1 border border-border rounded-full bg-background text-muted-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
        ) : (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
            {STAGE_LABEL[application.stage]}
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {application.partner ? (
          <Link
            to={`/projects?q=${encodeURIComponent(application.partner.name)}`}
            className="text-accent-coral hover:underline"
          >
            {application.partner.name}
          </Link>
        ) : (
          <span className="text-foreground">
            {application.applicant?.name ?? "Unknown applicant"}
            {application.applicant?.email ? ` · ${application.applicant.email}` : ""}
          </span>
        )}
        {application.targetTerms.length > 0
          ? ` · Target ${application.targetTerms.map((t) => t.code).join(", ")}`
          : " · No target term"}
        {application.resultingProjectId && (
          <>
            {" · "}
            <Link
              to={`/projects/${application.resultingProjectId}`}
              className="text-accent-coral hover:underline"
            >
              View project
            </Link>
          </>
        )}
      </p>
    </header>
  );
}

function DetailsSection({
  application,
  terms,
  canEdit,
}: {
  application: LoaderData["application"];
  terms: LoaderData["terms"];
  canEdit: boolean;
}) {
  return (
    <Form
      method="post"
      className="bg-card border border-border rounded-lg p-4 flex flex-col gap-4"
    >
      <input type="hidden" name="intent" value="details" />
      <h2 className="text-sm font-semibold text-foreground">Details</h2>

      {/* Core-written synopsis — partners never see or set this (their prose
          lives in the application answers). Hidden in read mode when empty
          so partner-submitted applications don't render a blank row. */}
      {(canEdit || application.summary !== null) && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Internal summary</span>
          {canEdit ? (
            <textarea
              name="summary"
              rows={3}
              defaultValue={application.summary ?? ""}
              placeholder="One-paragraph synopsis for the lab. Partners don't see this. The full SOW lives below."
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          ) : (
            <span className="px-2 py-1.5 text-sm text-foreground whitespace-pre-wrap">
              {application.summary}
            </span>
          )}
        </label>
      )}

      <TargetTermsField
        terms={terms}
        selected={application.targetTerms}
        canEdit={canEdit}
      />

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
  );
}

// Multiple target terms: one dropdown row per selected term, each posting its
// value as `targetTermId` (the action reads all of them). A term already
// picked in another row is hidden from the remaining dropdowns so the same
// term can't be added twice. An empty list posts no targetTermId, which the
// action treats as "clear all target terms".
function TargetTermsField({
  terms,
  selected,
  canEdit,
}: {
  terms: LoaderData["terms"];
  selected: LoaderData["application"]["targetTerms"];
  canEdit: boolean;
}) {
  // "" is the placeholder for a freshly-added, not-yet-chosen row.
  const [rows, setRows] = useState<string[]>(() =>
    selected.map((t) => t.termId),
  );

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-1 text-xs sm:max-w-xs">
        <span className="text-muted-foreground">Target terms</span>
        <span className="px-2 py-1.5 text-sm text-foreground">
          {selected.length > 0
            ? selected.map((t) => t.code).join(", ")
            : "—"}
        </span>
      </div>
    );
  }

  const chosen = new Set(rows.filter(Boolean));

  return (
    <fieldset className="flex flex-col gap-2 text-xs sm:max-w-xs">
      <legend className="text-muted-foreground mb-1">
        Target terms
        <span className="ml-1 text-muted-foreground/70">
          (add one per expected term)
        </span>
      </legend>

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          No target terms.
        </p>
      )}

      {rows.map((value, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select
            name="targetTermId"
            value={value}
            onChange={(newValue) =>
              setRows((r) => r.map((v, j) => (j === i ? newValue : v)))
            }
            placeholder="Select a term…"
            options={[
              { value: "", label: "Select a term…" },
              ...terms
                .filter((t) => t.id === value || !chosen.has(t.id))
                .map((t) => ({ value: t.id, label: t.code })),
            ]}
            buttonClassName="flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
          <button
            type="button"
            onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
            aria-label="Remove term"
            className="px-2 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
          >
            Remove
          </button>
        </div>
      ))}

      {chosen.size < terms.length && (
        <button
          type="button"
          onClick={() => setRows((r) => [...r, ""])}
          className="self-start text-xs font-medium text-accent-coral hover:underline"
        >
          + Add term
        </button>
      )}
    </fieldset>
  );
}

function DomainScopeBlock({
  applicationId,
  domains,
  availableDomains,
  canEdit,
}: {
  applicationId: string;
  domains: LoaderData["application"]["domains"];
  availableDomains: LoaderData["availableDomains"];
  canEdit: boolean;
}) {
  const revalidator = useRevalidator();
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newDomainId, setNewDomainId] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    fn()
      .then(() => revalidator.revalidate())
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Something went wrong"),
      )
      .finally(() => setBusy(false));
  }

  async function call(url: string, method: "POST" | "DELETE", body?: unknown) {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? `Request failed: ${res.status}`);
    }
  }

  const total = domains.reduce((s, d) => s + d.expectedMembers, 0);

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Expected scope per domain
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Drives the projected lab headcount for the target term.
          </p>
        </div>
        {canEdit && !adding && availableDomains.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-medium text-accent-coral hover:underline"
          >
            + Add domain
          </button>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {adding && canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newDomainId) return;
            run(async () => {
              await call(
                `/api/partner-applications/${applicationId}/domains`,
                "POST",
                { domainId: newDomainId },
              );
              setAdding(false);
              setNewDomainId("");
            });
          }}
          className="flex items-end gap-2 mb-3"
        >
          <label className="flex flex-col gap-1 text-xs flex-1">
            <span className="text-muted-foreground">Domain</span>
            <Select
              value={newDomainId}
              onChange={(value) => setNewDomainId(value)}
              placeholder="Select a domain…"
              options={[
                { value: "", label: "Select a domain…" },
                ...availableDomains.map((d) => ({ value: d.id, label: d.displayName })),
              ]}
              buttonClassName="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !newDomainId}
            className={buttonClasses("primary", "sm")}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewDomainId("");
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      {domains.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground italic">
          No domain scope defined yet.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {domains.map((d) =>
            editId === d.id ? (
              <DomainScopeEditRow
                key={d.id}
                row={d}
                busy={busy}
                onCancel={() => setEditId(null)}
                onSave={(members, challenges) => {
                  run(async () => {
                    await call(
                      `/api/partner-application-domains/${d.id}`,
                      "POST",
                      {
                        expectedMembers: members,
                        expectedChallenges: challenges,
                      },
                    );
                    setEditId(null);
                  });
                }}
              />
            ) : (
              <div key={d.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {d.domainName}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-foreground tabular-nums">
                        {d.expectedMembers}{" "}
                        {d.expectedMembers === 1 ? "member" : "members"}
                      </span>
                    </div>
                    {!isEmptyBlocks(d.expectedChallenges) ? (
                      <DocEditor
                        key={d.id}
                        features="notes"
                        density="compact"
                        editable={false}
                        initialContent={d.expectedChallenges}
                        className="text-sm text-muted-foreground mt-1"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground italic mt-1">
                        No scope description.
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditId(d.id)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            !(await dialog.confirm({
                              title: `Remove ${d.domainName} from this application?`,
                              description: "Answers given for this domain are deleted.",
                              confirmLabel: "Remove",
                              tone: "destructive",
                            }))
                          )
                            return;
                          run(() =>
                            call(
                              `/api/partner-application-domains/${d.id}`,
                              "DELETE",
                            ),
                          );
                        }}
                        className="text-xs text-destructive hover:underline disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          {domains.length > 0 && (
            <div className="py-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Total expected members
              </span>
              <span className="font-semibold text-foreground tabular-nums">
                {total}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
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
  onSave: (expectedMembers: number, expectedChallenges: unknown) => void;
}) {
  const [members, setMembers] = useState<string>(String(row.expectedMembers));
  const [challenges, setChallenges] = useState<unknown>(row.expectedChallenges);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = Math.max(0, Number(members) || 0);
        onSave(n, isEmptyBlocks(challenges) ? null : challenges);
      }}
      className="py-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {row.domainName}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className={buttonClasses("primary", "sm")}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      <label className="flex flex-col gap-1 text-xs sm:max-w-[180px]">
        <span className="text-muted-foreground">Expected members</span>
        <input
          type="number"
          min={0}
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">
          Expected challenges / scope
        </span>
        <DocEditor
          features="notes"
          density="compact"
          initialContent={row.expectedChallenges}
          onChange={setChallenges}
          placeholder="What does the partner expect this domain to deliver?"
          className="rounded-md border border-border bg-card py-2"
        />
      </label>
    </form>
  );
}

function SowBlock({
  applicationId,
  canEdit,
  collabToken,
  userName,
}: {
  applicationId: string;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
}) {
  // The SOW is a single collab doc per application. Versioning + history come
  // for free from the CollabDocumentVersion auto-snapshot machinery (same as
  // project documents); the editor exposes the version-history panel itself.
  const documentName = `partnersow:${applicationId}:body`;
  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-foreground mb-3">
        Statement of Work
      </h2>
      {collabToken ? (
        <PresenceProvider
          pageId={`partnersow:${applicationId}`}
          token={collabToken}
          userName={userName}
        >
          <DocEditor
            features="notes"
            editable={canEdit}
            placeholder="Draft the statement of work…"
            className="border border-border rounded-md bg-card py-2"
            collab={{
              documentName,
              token: collabToken,
              userName,
            }}
          />
        </PresenceProvider>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          Sign in again to edit the statement of work.
        </p>
      )}
    </section>
  );
}
