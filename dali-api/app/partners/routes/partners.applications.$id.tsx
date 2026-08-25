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
} from "lucide-react";
import { UnderlineTabButtons } from "~/components/AreaPillNav";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { PartnerActivityFeed } from "../components/PartnerActivityFeed";
import type { Route } from "./+types/partners.applications.$id";
import { prisma } from "~/lib/db";
import { githubTeamSlug } from "~/lib/github-slug";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { parseSessionCookie } from "~/lib/cookies";
import { canViewStaffing, isCore, getActiveCoreCycleTermIds } from "~/lib/roles";
import {
  PARTNER_APPLICATION_STATUSES as STATUSES,
  PARTNER_APPLICATION_STATUS_LABELS as STATUS_LABEL,
  isPartnerApplicationStatus,
  type PartnerApplicationStatus as Status,
} from "../lib/partner-application";
import { formAnswerRows } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { isEmptyBlocks } from "~/lib/blocks";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { useDialog, useConfirmSubmit } from "~/components/ui/dialog";
import {
  EVAL_CRITERIA,
  EVAL_CRITERIA_VERSION,
  FIRST_MEETING_PROMPTS,
  parseEvalRubric,
  type EvalCriterionKey,
} from "../lib/discovery-rubric";
import {
  sendTriageNextStepsEmail,
  sendMeetingInviteEmail,
  sendDecisionAcceptedEmail,
  sendDecisionRejectedEmail,
  sendLearnMoreRequestEmail,
} from "../lib/partner-emails.server";
import {
  logPartnerActivity,
  setApplicationStatus,
} from "../lib/partner-activity.server";
import { getFrontendUrl } from "~/lib/app-env";
import type { PartnerMeetingOutcome } from "~/generated/prisma/enums";

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

// Resolves the dynamic leaf crumb so the trail reads
// "Partners › Applications › <title>" instead of a raw id.
export const handle = {
  breadcrumb: (data: unknown) =>
    (data as { application?: { title?: string } } | undefined)?.application
      ?.title ?? null,
};


export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const application = await prisma.partnerApplication.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      summary: true,
      status: true,
      sowDocId: true,
      resultingProjectId: true,
      source: true,
      assignedMeeterId: true,
      evalRubric: true,
      interviewRating: true,
      ambiguityRating: true,
      fundingModel: true,
      decisionReason: true,
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

  const collabToken = parseSessionCookie(request);
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
      actorUserId: true,
      type: true,
      body: true,
      metadata: true,
    },
  });
  activities = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
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

  return {
    application: {
      id: application.id,
      title: application.title,
      summary: application.summary,
      status: application.status,
      sowDocId: application.sowDocId,
      resultingProjectId: application.resultingProjectId,
      targetTerms: application.targetTerms.map((t) => ({
        termId: t.termId,
        code: t.term.code,
      })),
      partner: application.partnerOrg,
      applicant: application.applicantContact,
      source: application.source,
      assignedMeeterId: application.assignedMeeterId,
      evalRubric: application.evalRubric,
      interviewRating: application.interviewRating,
      ambiguityRating: application.ambiguityRating,
      fundingModel: application.fundingModel,
      decisionReason: application.decisionReason,
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
  } else if (intent === "status") {
    const status = form.get("status");
    if (!isPartnerApplicationStatus(status)) {
      return { error: "Invalid status." };
    }
    await setApplicationStatus(prisma, {
      applicationId: params.id,
      to: status,
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
      await setApplicationStatus(tx, {
        applicationId: app.id,
        to: "Promoted",
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
    intent === "assign-meeter" ||
    intent === "eval" ||
    intent === "acceptance" ||
    intent === "meeting-create" ||
    intent === "meeting-debrief" ||
    intent === "note"
  ) {
    if (intent === "offer-meeting") {
      const when = (form.get("when") as string | null)?.trim() ?? "";
      const details = (form.get("details") as string | null)?.trim() || undefined;
      if (!when) return { error: "Meeting time is required." };
      const applicant = await prisma.partnerApplication.findUnique({
        where: { id: params.id },
        select: { applicantContact: { select: { name: true, email: true } } },
      });
      await setApplicationStatus(prisma, {
        applicationId: params.id,
        to: "Meeting",
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
      await setApplicationStatus(prisma, {
        applicationId: params.id,
        to: "Triaged",
        actorUserId: auth.user.sub,
      });
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
      const reason = (form.get("reason") as string | null)?.trim() || undefined;
      const applicant = await prisma.partnerApplication.findUnique({
        where: { id: params.id },
        select: { applicantContact: { select: { name: true, email: true } } },
      });
      await setApplicationStatus(prisma, {
        applicationId: params.id,
        to: "Rejected",
        actorUserId: auth.user.sub,
        data: { decisionReason: reason ?? null },
        ...(reason ? { meta: { reason } } : {}),
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
      await setApplicationStatus(prisma, {
        applicationId: params.id,
        to: "LearnMore",
        actorUserId: auth.user.sub,
        data: { decisionReason: whatWeNeed },
        meta: { reason: whatWeNeed },
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
      await setApplicationStatus(prisma, {
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

    } else if (intent === "assign-meeter") {
      const meeterId = (form.get("meeterId") as string | null)?.trim() || null;
      await prisma.partnerApplication.update({
        where: { id: params.id },
        data: { assignedMeeterId: meeterId },
      });

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
      const fundingModel = (form.get("fundingModel") as string | null)?.trim() || null;
      await prisma.partnerApplication.update({
        where: { id: params.id },
        data: {
          ...(ambiguityRating !== null ? { ambiguityRating } : {}),
          fundingModel,
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
    }

  } else {
    return { error: "Unknown action." };
  }
  return redirect(`/partners/applications/${params.id}`);
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
  } = useLoaderData() as LoaderData;
  // Always-inline editing (gated only by permission), matching the rest of the
  // site — no view/edit mode toggle.
  const canEdit = canEditPerm;
  const actionData = useActionData<typeof action>();
  const [tab, setTab] = useState<
    "overview" | "evaluation" | "meetings" | "details" | "sow"
  >("overview");

  const topBar = actionData?.error ? (
    <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
      {actionData.error}
    </div>
  ) : null;

  const header = <Header application={application} canEdit={canEdit} />;
  const details = (
    <DetailsSection application={application} terms={terms} canEdit={canEdit} />
  );
  // CRM working sections (only meaningful with edit permission).
  const triageBar = canEdit ? (
    <TriageBar application={application} coreMembers={coreMembers} />
  ) : null;
  const evaluation = canEdit ? (
    <EvaluationCard application={application} />
  ) : null;
  const meetings = canEdit ? (
    <div id="partner-meetings" className="scroll-mt-4">
      <MeetingsSection
        applicationId={application.id}
        meetings={application.meetings}
        coreMembers={coreMembers}
      />
    </div>
  ) : null;
  const promoteBlock = (
    <PromoteBlock application={application} canEdit={canEdit} />
  );
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
  const assignedMeeterName =
    coreMembers.find((m) => m.userId === application.assignedMeeterId)?.name ??
    null;
  const expectedTotal = application.domains.reduce(
    (s, d) => s + d.expectedMembers,
    0,
  );

  const activityFeed = (
    <PartnerActivityFeed
      activities={activities}
      actorNames={actorNames}
      canEdit={canEdit}
      headerActions={
        canEdit ? (
          <button
            type="button"
            onClick={() => setTab("meetings")}
            className={buttonClasses("ghost", "sm")}
          >
            <Calendar className="w-3.5 h-3.5" /> Log meeting
          </button>
        ) : undefined
      }
    />
  );

  const keyFields = (
    <section className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-foreground mb-3">Key details</h2>
      <dl className="flex flex-col gap-2.5">
        <KeyRow
          label="Partner"
          value={application.partner?.name ?? application.applicant?.name ?? "—"}
        />
        <KeyRow
          label="Target terms"
          value={
            application.targetTerms.length
              ? application.targetTerms.map((t) => t.code).join(", ")
              : "—"
          }
        />
        <KeyRow
          label="Assigned meeter"
          value={assignedMeeterName ?? "Unassigned"}
        />
        <KeyRow label="Expected members" value={String(expectedTotal)} />
        <KeyRow label="Source" value={application.source} />
      </dl>
    </section>
  );

  const TABS = [
    { key: "overview", label: "Overview", icon: LayoutGrid },
    { key: "evaluation", label: "Evaluation", icon: ClipboardList },
    { key: "meetings", label: "Meetings", icon: Calendar },
    { key: "details", label: "Details", icon: Info },
    { key: "sow", label: "Statement of Work", icon: FileText },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      {topBar}

      {/* Top band — identity, stage progression, and triage/advance actions,
          always visible above the tabs. */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        {header}
        {triageBar}
        {application.status === "Accepted" && promoteBlock}
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
          {keyFields}
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
    </div>
  );
}

function KeyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-sm text-foreground text-right">{value}</dd>
    </div>
  );
}

// ─── CRM: Triage / decision bar + assign-meeter ───────────────────────────────

// Happy-path funnel order for the stepper + the sequential "advance" CTA.
// Branch states (LearnMore, OnHold, Rejected) sit off this main line.
const FUNNEL_ORDER = [
  "Inquiry",
  "Triaged",
  "Meeting",
  "ApplicationSubmitted",
  "UnderReview",
  "Accepted",
  "Promoted",
] as const;

const STEP_SHORT: Record<(typeof FUNNEL_ORDER)[number], string> = {
  Inquiry: "Inquiry",
  Triaged: "Triaged",
  Meeting: "Meeting",
  ApplicationSubmitted: "Applied",
  UnderReview: "Review",
  Accepted: "Accepted",
  Promoted: "Promoted",
};

// Branch/legacy states map onto the nearest main-line stage for the stepper.
const BRANCH_ANCHOR: Record<string, (typeof FUNNEL_ORDER)[number]> = {
  LearnMore: "UnderReview",
  OnHold: "UnderReview",
  Rejected: "UnderReview",
  Submitted: "ApplicationSubmitted",
};

function StatusStepper({ status }: { status: Status }) {
  const onPath = (FUNNEL_ORDER as readonly string[]).includes(status);
  const currentIdx = FUNNEL_ORDER.indexOf(
    onPath
      ? (status as (typeof FUNNEL_ORDER)[number])
      : (BRANCH_ANCHOR[status] ?? "Inquiry"),
  );
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
              {STEP_SHORT[s]}
            </span>
            {i < FUNNEL_ORDER.length - 1 && (
              <span className="text-muted-foreground/40 text-[10px]">›</span>
            )}
          </li>
        );
      })}
      {status === "Rejected" && (
        <li className="ml-1 text-[11px] px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/20">
          Rejected
        </li>
      )}
    </ol>
  );
}

function TriageBar({
  application,
  coreMembers,
}: {
  application: LoaderData["application"];
  coreMembers: LoaderData["coreMembers"];
}) {
  const submit = useSubmit();
  const confirmSubmit = useConfirmSubmit();
  const [showing, setShowing] = useState<
    "offer-meeting" | "send-application" | "reject" | "learn-more" | null
  >(null);

  const submitStatus = (to: Status) => {
    const fd = new FormData();
    fd.set("intent", "status");
    fd.set("status", to);
    submit(fd, { method: "post" });
  };

  const SECONDARY =
    "px-3 py-1.5 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted transition-colors";
  const openBtn = (
    kind: "offer-meeting" | "send-application" | "reject" | "learn-more",
    label: string,
    primary = false,
  ) => (
    <button
      type="button"
      onClick={() => setShowing(showing === kind ? null : kind)}
      className={primary ? buttonClasses("primary", "sm") : SECONDARY}
    >
      {label}
    </button>
  );

  // The sequential "advance to next status" primary CTA is status-aware — it
  // reuses the existing side-effecting forms (offer meeting / send application /
  // accept) or a direct status move. Off-ramps (reject, learn-more) stay as
  // secondary actions; the full any→any dropdown lives in the header.
  const status = application.status;
  let primary: ReactNode = null;
  const secondary: ReactNode[] = [];
  switch (status) {
    case "Inquiry":
      primary = openBtn("send-application", "Send application →", true);
      secondary.push(openBtn("offer-meeting", "Offer meeting"));
      break;
    case "Triaged":
      primary = openBtn("offer-meeting", "Offer meeting →", true);
      secondary.push(openBtn("send-application", "Resend application"));
      break;
    case "Meeting":
    case "ApplicationSubmitted":
      primary = (
        <button
          type="button"
          onClick={() => submitStatus("UnderReview")}
          className={buttonClasses("primary", "sm")}
        >
          Start review →
        </button>
      );
      secondary.push(openBtn("offer-meeting", "Offer another meeting"));
      break;
    case "UnderReview":
      primary = (
        <Form
          method="post"
          onSubmit={confirmSubmit({
            title: "Accept this partner?",
            description:
              "This will mark the application as Accepted and notify the partner.",
            confirmLabel: "Accept",
          })}
          className="inline"
        >
          <input type="hidden" name="intent" value="accept" />
          <button type="submit" className={buttonClasses("primary", "sm")}>
            Accept →
          </button>
        </Form>
      );
      secondary.push(openBtn("learn-more", "Need more info"));
      break;
    case "LearnMore":
    case "OnHold":
      primary = (
        <button
          type="button"
          onClick={() => submitStatus("UnderReview")}
          className={buttonClasses("primary", "sm")}
        >
          Resume review →
        </button>
      );
      break;
    case "Accepted":
      // Promotion is handled by the PromoteBlock in the top band at this stage.
      break;
    case "Rejected":
      secondary.push(
        <button
          key="reopen"
          type="button"
          onClick={() => submitStatus("UnderReview")}
          className={SECONDARY}
        >
          Reopen
        </button>,
      );
      break;
    // Promoted: terminal — no actions.
  }
  if (!["Accepted", "Rejected", "Promoted"].includes(status)) {
    secondary.push(openBtn("reject", "Reject"));
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <StatusStepper status={status} />
      {status === "Promoted" ? (
        <p className="text-xs text-muted-foreground">
          Promoted to a project — this opportunity is complete.
        </p>
      ) : primary || secondary.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {primary}
          {secondary.map((node, i) => (
            <span key={i}>{node}</span>
          ))}
        </div>
      ) : null}

      {/* Inline forms for actions that need extra input */}
      {showing === "offer-meeting" && (
        <Form method="post" className="flex flex-col gap-2 p-3 bg-muted/30 rounded-md border border-border">
          <input type="hidden" name="intent" value="offer-meeting" />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Meeting time *</span>
            <input
              name="when"
              required
              placeholder="e.g. Tuesday Jan 14, 2:00 PM ET"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Details (optional)</span>
            <textarea
              name="details"
              rows={2}
              placeholder="Link, location, agenda…"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 resize-none"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={buttonClasses("primary", "sm")}>
              Send invite
            </button>
            <button type="button" onClick={() => setShowing(null)} className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors">
              Cancel
            </button>
          </div>
        </Form>
      )}

      {showing === "send-application" && (
        <Form method="post" className="flex flex-col gap-2 p-3 bg-muted/30 rounded-md border border-border">
          <input type="hidden" name="intent" value="send-application" />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Next steps message</span>
            <textarea
              name="nextSteps"
              rows={3}
              placeholder="Tell the partner what comes next. A link to apply will be appended automatically."
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 resize-none"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={buttonClasses("primary", "sm")}>
              Send email
            </button>
            <button type="button" onClick={() => setShowing(null)} className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors">
              Cancel
            </button>
          </div>
        </Form>
      )}

      {showing === "learn-more" && (
        <Form method="post" className="flex flex-col gap-2 p-3 bg-muted/30 rounded-md border border-border">
          <input type="hidden" name="intent" value="learn-more" />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">What do we need from them? *</span>
            <textarea
              name="whatWeNeed"
              rows={3}
              required
              placeholder="Describe the specific information or materials you need…"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 resize-none"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors">
              Send request
            </button>
            <button type="button" onClick={() => setShowing(null)} className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors">
              Cancel
            </button>
          </div>
        </Form>
      )}

      {showing === "reject" && (
        <Form method="post" className="flex flex-col gap-2 p-3 bg-muted/30 rounded-md border border-border">
          <input type="hidden" name="intent" value="reject" />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Reason (shown to partner, optional)</span>
            <textarea
              name="reason"
              rows={2}
              placeholder="Brief, partner-facing explanation…"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 resize-none"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="px-3 py-1.5 text-xs font-medium rounded-md bg-destructive text-white hover:bg-destructive/90 transition-colors">
              Reject
            </button>
            <button type="button" onClick={() => setShowing(null)} className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors">
              Cancel
            </button>
          </div>
        </Form>
      )}

      {/* Assign meeter */}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs text-muted-foreground shrink-0">Assigned meeter</span>
        <Select
          name="meeterId"
          value={application.assignedMeeterId ?? ""}
          onChange={(value) => {
            const fd = new FormData();
            fd.set("intent", "assign-meeter");
            fd.set("meeterId", value);
            submit(fd, { method: "post" });
          }}
          placeholder="Unassigned"
          options={[
            { value: "", label: "Unassigned" },
            ...coreMembers.map((m) => ({ value: m.userId, label: m.name })),
          ]}
          buttonClassName="text-xs px-2 py-1 border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 min-w-[140px] transition-colors hover:bg-muted/40"
        />
      </div>
    </div>
  );
}

// ─── CRM: Acceptance fields ───────────────────────────────────────────────────

function AcceptanceFields({ application }: { application: LoaderData["application"] }) {
  return (
    <Form method="post" className="flex flex-col gap-3 mt-4 pt-4 border-t border-border">
      <input type="hidden" name="intent" value="acceptance" />
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Acceptance notes</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Ambiguity rating (1–5)</span>
          <input
            type="number"
            name="ambiguityRating"
            min={1}
            max={5}
            step={1}
            defaultValue={application.ambiguityRating ?? ""}
            placeholder="1–5"
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Funding model</span>
          <input
            type="text"
            name="fundingModel"
            defaultValue={application.fundingModel ?? ""}
            placeholder="e.g. Magnuson grant, self-funded…"
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </label>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          className={buttonClasses("primary", "sm")}
        >
          Save
        </button>
      </div>
    </Form>
  );
}

// ─── CRM: Evaluation card ─────────────────────────────────────────────────────

function EvaluationCard({ application }: { application: LoaderData["application"] }) {
  const rubric = parseEvalRubric(application.evalRubric);

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-foreground mb-1">Evaluation</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Score each criterion 1 (low) – 5 (high) after the discovery meeting.
      </p>

      {/* First-meeting prompts */}
      <div className="mb-4 bg-muted/30 rounded-md p-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">Discovery meeting prompts</p>
        <ol className="list-decimal list-inside space-y-1">
          {FIRST_MEETING_PROMPTS.map((p, i) => (
            <li key={i} className="text-xs text-muted-foreground">{p}</li>
          ))}
        </ol>
      </div>

      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="eval" />

        {EVAL_CRITERIA.map((c) => (
          <div key={c.key} className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">{c.label}</p>
              <p className="text-xs text-muted-foreground">{c.description}</p>
            </div>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="cursor-pointer">
                  <input
                    type="radio"
                    name={`score_${c.key}`}
                    value={String(n)}
                    defaultChecked={rubric[c.key as EvalCriterionKey] === n}
                    className="sr-only peer"
                  />
                  <span className="w-7 h-7 flex items-center justify-center text-xs font-medium rounded border border-border text-muted-foreground peer-checked:bg-accent-coral peer-checked:text-white peer-checked:border-accent-coral hover:bg-muted transition-colors">
                    {n}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <label className="flex items-center gap-2 text-xs font-medium text-foreground flex-1">
            <span>Overall interview rating (1–5)</span>
          </label>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="cursor-pointer">
                <input
                  type="radio"
                  name="interviewRating"
                  value={String(n)}
                  defaultChecked={application.interviewRating === n}
                  className="sr-only peer"
                />
                <span className="w-7 h-7 flex items-center justify-center text-xs font-medium rounded border border-border text-muted-foreground peer-checked:bg-accent-coral peer-checked:text-white peer-checked:border-accent-coral hover:bg-muted transition-colors">
                  {n}
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Eval notes</span>
          <textarea
            name="evalNotes"
            rows={3}
            defaultValue={rubric.notes ?? ""}
            placeholder="Notes for the team…"
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 resize-none"
          />
        </label>

        <div className="flex justify-end">
          <button
            type="submit"
            className={buttonClasses("primary", "sm")}
          >
            Save evaluation
          </button>
        </div>
      </Form>
    </section>
  );
}

// ─── CRM: Meetings section ────────────────────────────────────────────────────

const OUTCOME_LABELS: Record<string, string> = {
  Advance: "Advance",
  Hold: "Hold",
  Reject: "Reject",
  MoreInfoNeeded: "Need more info",
};

const OUTCOME_PILL: Record<string, string> = {
  Advance: "bg-accent-teal/15 text-accent-teal",
  Hold: "bg-amber-500/15 text-amber-600",
  Reject: "bg-destructive/10 text-destructive",
  MoreInfoNeeded: "bg-muted text-muted-foreground",
};

function MeetingsSection({
  applicationId,
  meetings,
  coreMembers,
}: {
  applicationId: string;
  meetings: LoaderData["application"]["meetings"];
  coreMembers: LoaderData["coreMembers"];
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [debriefOpenId, setDebriefOpenId] = useState<string | null>(null);

  const memberById = new Map(coreMembers.map((m) => [m.userId, m.name]));

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Meetings</h2>
        {!showAdd && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs font-medium text-accent-coral hover:underline"
          >
            + Add meeting
          </button>
        )}
      </div>

      {showAdd && (
        <Form
          method="post"
          onSubmit={() => setShowAdd(false)}
          className="flex flex-col gap-3 mb-4 p-3 bg-muted/30 rounded-md border border-border"
        >
          <input type="hidden" name="intent" value="meeting-create" />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground font-medium">Date & time *</span>
              <DateField
                mode="datetime-local"
                name="meetingDate"
                required
                ariaLabel="Meeting date and time"
              />
            </label>
          </div>
          <fieldset>
            <legend className="text-xs text-muted-foreground font-medium mb-1">Attendees</legend>
            <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto">
              {coreMembers.map((m) => (
                <Checkbox
                  key={m.userId}
                  name="attendeeUserIds"
                  value={m.userId}
                  label={m.name}
                  className="text-xs"
                />
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Notes</span>
            <textarea
              name="meetingNotes"
              rows={2}
              placeholder="Pre-meeting notes or agenda…"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 resize-none"
            />
          </label>
          <Checkbox
            name="notifyPartner"
            label="Email partner a meeting invite"
            className="text-xs"
          />
          <div className="flex gap-2">
            <button type="submit" className={buttonClasses("primary", "sm")}>
              Log meeting
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className={buttonClasses("secondary", "sm")}
            >
              Cancel
            </button>
          </div>
        </Form>
      )}

      {meetings.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No meetings logged yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {meetings.map((m) => {
            const date = new Date(m.scheduledAt);
            const attendeeNames = m.attendeeUserIds
              .map((uid) => memberById.get(uid) ?? uid)
              .join(", ");
            return (
              <div key={m.id} className="py-3 flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {date.toLocaleDateString("en-US", { dateStyle: "medium" })}{" "}
                      <span className="text-muted-foreground font-normal">
                        {date.toLocaleTimeString("en-US", { timeStyle: "short" })}
                      </span>
                    </p>
                    {attendeeNames && (
                      <p className="text-xs text-muted-foreground">{attendeeNames}</p>
                    )}
                    {m.notes && (
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{m.notes}</p>
                    )}
                    {m.debrief && (
                      <p className="text-xs text-foreground mt-1 whitespace-pre-wrap">{m.debrief}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {m.outcome && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${OUTCOME_PILL[m.outcome] ?? "bg-muted text-muted-foreground"}`}>
                        {OUTCOME_LABELS[m.outcome] ?? m.outcome}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setDebriefOpenId(debriefOpenId === m.id ? null : m.id)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {debriefOpenId === m.id ? "Close" : "Debrief"}
                    </button>
                  </div>
                </div>

                {debriefOpenId === m.id && (
                  <Form
                    method="post"
                    onSubmit={() => setDebriefOpenId(null)}
                    className="flex flex-col gap-2 mt-1 p-3 bg-muted/30 rounded-md border border-border"
                  >
                    <input type="hidden" name="intent" value="meeting-debrief" />
                    <input type="hidden" name="meetingId" value={m.id} />
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground font-medium">Debrief notes</span>
                      <textarea
                        name="debrief"
                        rows={3}
                        defaultValue={m.debrief ?? ""}
                        placeholder="What happened? Key takeaways…"
                        className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 resize-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground font-medium">Outcome</span>
                      <Select
                        name="outcome"
                        defaultValue={m.outcome ?? ""}
                        ariaLabel="Meeting outcome"
                        options={[
                          { value: "", label: "No outcome set" },
                          { value: "Advance", label: "Advance" },
                          { value: "Hold", label: "Hold" },
                          { value: "Reject", label: "Reject" },
                          { value: "MoreInfoNeeded", label: "Need more info" },
                        ]}
                        buttonClassName="w-full text-sm px-2 py-1.5 border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button type="submit" className={buttonClasses("primary", "sm")}>
                        Save debrief
                      </button>
                      <button
                        type="button"
                        onClick={() => setDebriefOpenId(null)}
                        className={buttonClasses("secondary", "sm")}
                      >
                        Cancel
                      </button>
                    </div>
                  </Form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
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
  const [editing, setEditing] = useState(false);
  const submit = useSubmit();

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
            name="status"
            defaultValue={application.status}
            ariaLabel="Application status"
            onChange={(value) => {
              const fd = new FormData();
              fd.set("intent", "status");
              fd.set("status", value);
              submit(fd, { method: "post" });
            }}
            options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            buttonClassName="text-xs px-2 py-1 border border-border rounded-full bg-background text-muted-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
        ) : (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
            {STATUS_LABEL[application.status]}
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

// The accept/promote decision block — the tail of the funnel. Pulled out of the
// header so it reads at the end of the record flow (after evaluation), not up
// top. Anchored (#promote) for the "Promote to project →" advance CTA.
function PromoteBlock({
  application,
  canEdit,
}: {
  application: LoaderData["application"];
  canEdit: boolean;
}) {
  const confirmSubmit = useConfirmSubmit();
  if (!canEdit || application.resultingProjectId) return null;
  return (
    <Form
      id="promote"
      method="post"
      onSubmit={confirmSubmit({
        title: "Create a project from this application?",
        description:
          "It will carry over the partner, start term, and per-domain role requests, and the two will be linked.",
        confirmLabel: "Create project",
      })}
      className="scroll-mt-4 bg-card border border-border rounded-lg p-4"
    >
      <input type="hidden" name="intent" value="promote" />
      {!application.partner && (
        <input
          type="text"
          name="orgName"
          placeholder="Organization name (optional — defaults to the applicant)"
          className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        />
      )}
      <AcceptanceFields application={application} />
      <div className="mt-3">
        <button type="submit" className={buttonClasses("primary", "sm")}>
          Promote to project →
        </button>
      </div>
    </Form>
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
              placeholder="One-paragraph synopsis for the lab — partners don't see this. The full SOW lives below."
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
