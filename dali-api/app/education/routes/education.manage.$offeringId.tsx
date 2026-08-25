import { useState } from "react";
import {
  redirect,
  useLoaderData,
  useActionData,
  useSearchParams,
  Form,
  Link,
} from "react-router";
import { Select, type SelectOption } from "~/components/ui/floating";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/education.manage.$offeringId";
import { requireAuth } from "~/lib/auth";
import { favoritePageIds } from "~/lib/user-pages.server";
import { isCore, currentTermMemberWhere } from "~/lib/roles";
import { requireOfferingManager } from "~/education/lib/access.server";
import {
  getOfferingDetail,
  runOfferingAction,
} from "~/education/lib/offerings.server";
import { listApplications } from "~/education/lib/apply.server";
import { decideApplication, approveAllPending } from "~/education/lib/decisions.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { ApplicationAnswers } from "~/education/components/ApplicationAnswers";
import { ApplicationsReview } from "~/education/components/ApplicationsReview";
import { RosterMatrix } from "~/education/components/RosterMatrix";
import { InstructorPicker } from "~/education/components/InstructorPicker";
import { AddFormModal } from "~/education/components/AddFormModal";
import { OfferingDiscussion } from "~/education/components/OfferingDiscussion";
import {
  listMaterialPages,
  listWorkspaceDocs,
  createMaterialPage,
  moveMaterialPage,
} from "~/education/lib/lms.server";
import {
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
} from "~/education/lib/assignments.server";
import { listDiscussion, postAnnouncement } from "~/education/lib/announcements.server";
import { builtinDecisionEmail } from "~/education/lib/notifications.server";
import {
  getAttendanceMatrix,
  getSessionRoster,
  saveAttendance,
} from "~/education/lib/attendance.server";
import { notesForOffering, upsertStudentNote } from "~/education/lib/student-notes.server";
import { closeOutOffering, previewCloseOut } from "~/education/lib/certificates.server";
import {
  setFormBinding,
  listFeedbackResults,
  SESSION_FEEDBACK_SLOT,
  INSTRUCTOR_EXIT_SLOT,
} from "~/education/lib/feedback.server";
import {
  ManageMaterials,
  ManageAssignments,
  ManageAnnouncements,
} from "~/education/components/ManageCourseContent";
import type { Question } from "~/types";
import type {
  AttendanceStatus,
  EduApplicationStatus,
  SubmissionType,
} from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";
import { Button, buttonClasses } from "~/components/ui/Button";
import { Avatar } from "~/components/ui/Avatar";
import { X } from "lucide-react";
import { renderEmail } from "~/lib/email";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { TypeBadge, StatusBadge, MyStatusChip } from "~/education/components/OfferingCard";
import { OfferingFields, toDatetimeLocal } from "~/education/components/OfferingFields";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { DateField } from "~/components/ui/DateField";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `Manage ${data?.offering.title ?? "Offering"} · DALI OS` },
];

export const handle = {
  breadcrumb: (data: { offering: { title: string } } | undefined) =>
    data?.offering.title ?? "Offering",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const authOrRedirect = await requireAuth(request);
  if (!authOrRedirect.ok) return redirectToLogin(request);

  const gate = await requireOfferingManager(request, params.offeringId!);
  if (!gate.ok) return redirect("/portal");

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering) throw new Response("Not found", { status: 404 });

  // Roster tab: ?session= picks the session, defaulting to the first one.
  const requestedSessionId = new URL(request.url).searchParams.get("session");
  const rosterSessionId = requestedSessionId ?? offering.sessions[0]?.id ?? null;
  const roster = rosterSessionId
    ? await getSessionRoster(params.offeringId!, rosterSessionId)
    : null;

  const core = await isCore(gate.auth.user.sub);
  const [
    instructorCandidates,
    applications,
    emailTemplates,
    decisionEmailBindings,
    materials,
    workspaceDocs,
    assignments,
    announcements,
    favoriteIds,
  ] = await Promise.all([
    core
      ? prisma.user.findMany({
          where: await currentTermMemberWhere(),
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
      : Promise.resolve([]),
    listApplications(params.offeringId!),
    prisma.emailTemplate.findMany({
      select: {
        id: true,
        name: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { id: true, versionNumber: true, subject: true, body: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.educationDecisionEmail.findMany({
      where: { offeringId: params.offeringId! },
      select: { status: true, emailTemplateVersionId: true },
    }),
    listMaterialPages(params.offeringId!),
    listWorkspaceDocs(params.offeringId!),
    listAssignments(params.offeringId!),
    listDiscussion(params.offeringId!),
    favoritePageIds(gate.auth.user.sub),
  ]);

  const notes = await notesForOffering(params.offeringId!);

  // Feedback bindings + results. Instructors see anonymized rows; Core may
  // see identities (moderation escape hatch).
  const [publishedForms, feedbackBindings, sessionFeedback, exitFeedback] =
    await Promise.all([
      prisma.form.findMany({
        where: { published: true, publicToken: { not: null } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.educationFormBinding.findMany({
        where: { offeringId: params.offeringId! },
        select: { slot: true, formId: true },
      }),
      rosterSessionId
        ? listFeedbackResults({
            offeringId: params.offeringId!,
            slot: SESSION_FEEDBACK_SLOT,
            sessionId: rosterSessionId,
            includeIdentities: core,
          })
        : Promise.resolve(null),
      core
        ? listFeedbackResults({
            offeringId: params.offeringId!,
            slot: INSTRUCTOR_EXIT_SLOT,
            includeIdentities: true,
          })
        : Promise.resolve(null),
    ]);

  const attendanceMatrix = await getAttendanceMatrix(params.offeringId!);

  // Instructors split by membership: members flow through the checkbox picker
  // (set-instructors), external Dartmouth instructors through the invite
  // controls below it. Both lists are Core-only (who owns the section).
  const memberInstructorRows = core
    ? await prisma.instructorAssignment.findMany({
        where: {
          offeringId: params.offeringId!,
          user: { daliMember: { isNot: null } },
        },
        select: { userId: true },
      })
    : [];
  const externalInstructorRows = core
    ? await prisma.instructorAssignment.findMany({
        where: {
          offeringId: params.offeringId!,
          user: { daliMember: { is: null } },
        },
        select: {
          userId: true,
          user: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const memberInstructorIds = [
    ...new Set(memberInstructorRows.map((r) => r.userId)),
  ];
  const externalInstructors = Array.from(
    new Map(
      externalInstructorRows.map((r) => [
        r.userId,
        {
          userId: r.userId,
          name: `${r.user.firstName} ${r.user.lastName}`.trim(),
        },
      ]),
    ).values(),
  );

  return {
    publishedForms,
    feedbackBindings,
    sessionFeedback,
    exitFeedback,
    feedbackSessionId: rosterSessionId,
    offering,
    applications: applications.map((a) => ({
      ...a,
      note: notes.get(a.id)
        ? {
            feedback: notes.get(a.id)!.feedback,
            internalNote: notes.get(a.id)!.internalNote,
          }
        : null,
    })),
    roster,
    attendanceMatrix,
    materials,
    workspaceDocs,
    favoriteIds: [...favoriteIds],
    assignments,
    // Discussion posts pass through whole — the component renders authors,
    // replies and the announcement/message distinction.
    announcements,
    emailTemplates: emailTemplates
      .filter((t) => t.versions.length > 0)
      .map((t) => ({
        name: t.name,
        versionId: t.versions[0]!.id,
        subject: t.versions[0]!.subject,
        body: t.versions[0]!.body,
      })),
    decisionEmailBindings,
    // The built-in copy that sends per status when no template is bound — so
    // the manager can preview the fallback instead of it being invisible.
    builtinDecisionCopy: {
      Approved: builtinDecisionEmail("Approved", offering.title),
      Waitlisted: builtinDecisionEmail("Waitlisted", offering.title),
      Rejected: builtinDecisionEmail("Rejected", offering.title),
    },
    isCore: core,
    instructorCandidates: instructorCandidates.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
    })),
    memberInstructorIds,
    externalInstructors,
    collabToken: parseSessionCookie(request),
    userName: `${gate.auth.user.firstName ?? ""} ${gate.auth.user.lastName ?? ""}`.trim(),
    currentUserId: gate.auth.user.sub,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();

  const intent = String(formData.get("intent") ?? "");
  const contentIntents = [
    "decide-application",
    "create-page",
    "move-page",
    "create-assignment",
    "update-assignment",
    "delete-assignment",
    "post-announcement",
    "save-attendance",
    "save-student-note",
    "close-out-offering",
    "set-form-binding",
  ];
  if (contentIntents.includes(intent)) {
    if (!(await isOfferingManager(auth.user.sub, params.offeringId!)))
      return Response.json({ error: "Forbidden" }, { status: 403 });

    const fail = (r: { error: string; status: number }) =>
      Response.json({ error: r.error }, { status: r.status });

    switch (intent) {
      case "decide-application": {
        // decideApplication self-scopes to offeringId, so a manager of another
        // offering can't act on this application.
        const result = await decideApplication({
          applicationId: String(formData.get("applicationId") ?? ""),
          offeringId: params.offeringId!,
          status: String(formData.get("status")) as EduApplicationStatus,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "approve-all-pending": {
        const result = await approveAllPending({
          offeringId: params.offeringId!,
          actorId: auth.user.sub,
        });
        return { ok: true, bulkApprove: result };
      }
      case "move-page": {
        const result = await moveMaterialPage({
          offeringId: params.offeringId!,
          pageId: String(formData.get("pageId") ?? ""),
          parentPageId: String(formData.get("parentPageId") ?? "") || null,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "create-page": {
        const result = await createMaterialPage({
          offeringId: params.offeringId!,
          title: String(formData.get("title") ?? ""),
          parentPageId: String(formData.get("parentPageId") ?? "") || null,
          studentEditable: formData.get("studentEditable") === "true",
          kind: formData.get("kind") === "Folder" ? "Folder" : "FreeForm",
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "create-assignment": {
        const dueAtRaw = String(formData.get("dueAt") ?? "");
        const result = await createAssignment({
          offeringId: params.offeringId!,
          sessionId: String(formData.get("sessionId") ?? "") || null,
          title: String(formData.get("title") ?? ""),
          dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
          submissionType: String(formData.get("submissionType")) as SubmissionType,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "update-assignment": {
        const dueAtRaw = String(formData.get("dueAt") ?? "");
        const result = await updateAssignment({
          assignmentId: String(formData.get("assignmentId") ?? ""),
          offeringId: params.offeringId!,
          title: String(formData.get("title") ?? ""),
          dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
          submissionType: String(formData.get("submissionType")) as SubmissionType,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "delete-assignment": {
        const result = await deleteAssignment({
          assignmentId: String(formData.get("assignmentId") ?? ""),
          offeringId: params.offeringId!,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "post-announcement": {
        const result = await postAnnouncement({
          offeringId: params.offeringId!,
          authorId: auth.user.sub,
          body: String(formData.get("body") ?? ""),
          kind: formData.get("kind") === "Message" ? "Message" : "Announcement",
          parentId: String(formData.get("parentId") ?? "") || null,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "set-form-binding": {
        const result = await setFormBinding({
          offeringId: params.offeringId!,
          slot: String(formData.get("slot") ?? ""),
          formId: String(formData.get("formId") ?? "") || null,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "preview-close-out": {
        const preview = await previewCloseOut(params.offeringId!);
        return { ok: true, closeOutPreview: preview };
      }
      case "close-out-offering": {
        const result = await closeOutOffering({
          offeringId: params.offeringId!,
          actorId: auth.user.sub,
        });
        if ("error" in result) return fail(result);
        return {
          ok: true,
          closeOut: {
            issued: result.issued,
            alreadyIssued: result.alreadyIssued,
            ineligible: result.ineligible,
          },
        };
      }
      case "save-student-note": {
        const applicationId = String(formData.get("applicationId") ?? "");
        const application = await prisma.educationApplication.findUnique({
          where: { id: applicationId },
          select: { offeringId: true },
        });
        if (!application || application.offeringId !== params.offeringId)
          return Response.json({ error: "Application not found" }, { status: 404 });
        const result = await upsertStudentNote({
          applicationId,
          actorId: auth.user.sub,
          feedback: String(formData.get("feedback") ?? ""),
          internalNote: String(formData.get("internalNote") ?? ""),
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "save-attendance": {
        // One `mark-<applicationId>` field per roster row; "" clears the mark.
        const marks: { applicationId: string; status: AttendanceStatus | null }[] = [];
        for (const [key, value] of formData.entries()) {
          if (!key.startsWith("mark-")) continue;
          marks.push({
            applicationId: key.slice("mark-".length),
            status: value === "" ? null : (String(value) as AttendanceStatus),
          });
        }
        const result = await saveAttendance({
          offeringId: params.offeringId!,
          sessionId: String(formData.get("sessionId") ?? ""),
          marks,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
    }
  }

  // Pin the offering id from the URL so a form can't retarget another offering.
  formData.set("offeringId", params.offeringId!);
  const result = await runOfferingAction(formData, auth.user.sub);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  if (formData.get("intent") === "delete-offering") return redirect("/education/manage");
  if (formData.get("intent") === "duplicate-offering" && "id" in result && result.id)
    return redirect(`/education/manage/${result.id}`);
  return result;
}

const TABS = [
  { key: "details", label: "Details" },
  { key: "sessions", label: "Sessions" },
  { key: "applications", label: "Applications" },
  { key: "roster", label: "Roster" },
  { key: "materials", label: "Materials" },
  { key: "assignments", label: "Assignments" },
  { key: "announcements", label: "Discussion" },
  { key: "feedback", label: "Feedback" },
] as const;

export default function ManageOffering() {
  const {
    offering,
    applications,
    roster,
    attendanceMatrix,
    materials,
    workspaceDocs,
    favoriteIds,
    assignments,
    announcements,
    emailTemplates,
    decisionEmailBindings,
    builtinDecisionCopy,
    publishedForms,
    feedbackBindings,
    sessionFeedback,
    exitFeedback,
    feedbackSessionId,
    isCore: core,
    instructorCandidates,
    memberInstructorIds,
    externalInstructors,
    collabToken,
    userName,
    currentUserId,
  } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();
  const actionData = useActionData<{
    error?: string;
    closeOut?: { issued: number; alreadyIssued: number; ineligible: number };
    closeOutPreview?: { eligible: string[]; belowThreshold: string[]; alreadyIssued: number } | null;
    bulkApprove?: { approved: number; skipped: number };
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const tab = searchParams.get("tab") ?? "details";

  const [appFilter, setAppFilter] = useState("all");
  const appCounts = applications.reduce<Record<string, number>>((m, a) => {
    m[a.status] = (m[a.status] ?? 0) + 1;
    return m;
  }, {});
  const filteredApps =
    appFilter === "all"
      ? applications
      : applications.filter((a) => a.status === appFilter);

  const nextStatuses: { to: string; label: string; variant: "primary" | "secondary" | "destructive" }[] =
    offering.status === "Draft"
      ? [{ to: "Published", label: "Publish", variant: "primary" }]
      : offering.status === "Published"
        ? [
            { to: "Draft", label: "Unpublish", variant: "secondary" },
            { to: "Archived", label: "Archive", variant: "destructive" },
          ]
        : [{ to: "Published", label: "Re-publish", variant: "secondary" }];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          {/* Title first: the badges qualify the offering, so they read better
              under its name than as an eyebrow above it. */}
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {offering.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <TypeBadge type={offering.type} />
            <StatusBadge status={offering.status} />
            <span className="text-sm text-muted-foreground">
              {offering.approvedCount} of {offering.capacity} seats filled
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Form
            method="post"
            onSubmit={confirmSubmit({
              title: "Close out this course?",
              description:
                "Certificates are issued to every approved student meeting the attendance threshold, and each gets an email. Re-running only issues missing certificates.",
              confirmLabel: "Close out",
            })}
          >
            <input type="hidden" name="intent" value="close-out-offering" />
            <Button type="submit" variant="secondary" size="sm">
              {offering.closedOutAt ? "Re-run close-out" : "Close out course"}
            </Button>
          </Form>
          {nextStatuses.map((s) => (
            <Form key={s.to} method="post">
              <input type="hidden" name="intent" value="set-status" />
              <input type="hidden" name="status" value={s.to} />
              <Button type="submit" variant={s.variant} size="sm">
                {s.label}
              </Button>
            </Form>
          ))}
        </div>
      </header>

      {actionData?.error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {actionData.error}
        </p>
      )}
      {actionData?.closeOut && (
        <p className="text-sm text-foreground bg-green-50 border border-green-200 rounded-md px-3 py-2">
          Close-out complete: {actionData.closeOut.issued} certificate
          {actionData.closeOut.issued === 1 ? "" : "s"} issued
          {actionData.closeOut.alreadyIssued > 0 &&
            `, ${actionData.closeOut.alreadyIssued} already issued`}
          {actionData.closeOut.ineligible > 0 &&
            `, ${actionData.closeOut.ineligible} below the attendance threshold`}
          .
        </p>
      )}
      {actionData?.closeOutPreview && (
        <div className="text-sm bg-card border border-border rounded-md px-3 py-2.5 flex flex-col gap-1">
          <p className="font-semibold text-foreground">
            Close-out preview — {actionData.closeOutPreview.eligible.length} would get a
            certificate
            {actionData.closeOutPreview.alreadyIssued > 0 &&
              `, ${actionData.closeOutPreview.alreadyIssued} already issued`}
            {actionData.closeOutPreview.belowThreshold.length > 0 &&
              `, ${actionData.closeOutPreview.belowThreshold.length} below threshold`}
            .
          </p>
          {actionData.closeOutPreview.belowThreshold.length > 0 && (
            <p className="text-xs text-amber-700">
              Below threshold: {actionData.closeOutPreview.belowThreshold.join(", ")}
            </p>
          )}
        </div>
      )}
      {actionData?.bulkApprove && (
        <p className="text-sm text-foreground bg-green-50 border border-green-200 rounded-md px-3 py-2">
          Approved {actionData.bulkApprove.approved} pending application
          {actionData.bulkApprove.approved === 1 ? "" : "s"}
          {actionData.bulkApprove.skipped > 0 &&
            ` — ${actionData.bulkApprove.skipped} left (capacity reached)`}
          .
        </p>
      )}

      <nav className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSearchParams({ tab: t.key }, { preventScrollReset: true })}
            className={cn(
              "px-4 py-2 text-sm font-semibold rounded-t-md",
              tab === t.key
                ? "text-accent-coral border-b-2 border-accent-coral"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "details" && (
        <div className="flex flex-col gap-6">
          {offering.applicationFormId && (
            <div className="bg-brand-tint rounded-lg px-4 py-3 flex items-center justify-between gap-4">
              <p className="text-sm text-foreground">
                Applicants answer this offering&apos;s application form.
                Fillers always see the latest saved version.
              </p>
              <Link
                to={`/forms/edit/${offering.applicationFormId}`}
                className={buttonClasses("secondary", "sm") + " shrink-0"}
              >
                Edit application form
              </Link>
            </div>
          )}

          <Form
            method="post"
            className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4"
          >
            <input type="hidden" name="intent" value="update-offering" />
            <OfferingFields values={offering} typeLocked />
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Save details
              </Button>
            </div>
          </Form>

          <section className="bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">
              Description
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Shown on the catalog listing. Edits save live.
            </p>
            {collabToken && offering.descriptionDocId ? (
              <PresenceProvider
                pageId={`eduoffering:${offering.id}`}
                token={collabToken}
                userName={userName}
              >
                <DocEditor
                  features="notes"
                  aiEnabled
                  collab={{
                    documentName: offering.descriptionDocId,
                    token: collabToken,
                    userName,
                  }}
                  placeholder="What this offering covers, who it's for, what attendees build…"
                  className="border border-border rounded-md"
                />
              </PresenceProvider>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Sign in again to edit the description.
              </p>
            )}
          </section>

          {core && (
            <>
              <Form
                method="post"
                className="bg-card border border-border rounded-lg p-5"
              >
                <input type="hidden" name="intent" value="set-instructors" />
                <h2 className="text-sm font-semibold text-foreground mb-1">
                  Instructors
                </h2>
                <p className="text-xs text-muted-foreground mb-3">
                  Instructors can edit this offering, review applications, and
                  take attendance.
                </p>
                <InstructorPicker
                  candidates={instructorCandidates}
                  initialSelectedIds={memberInstructorIds}
                />
                <div className="mt-3 flex justify-end">
                  <Button type="submit" variant="secondary" size="sm">
                    Save instructors
                  </Button>
                </div>
              </Form>

              <section className="bg-card border border-border rounded-lg p-5">
                <h2 className="text-sm font-semibold text-foreground mb-1">
                  External instructors
                </h2>
                <p className="text-xs text-muted-foreground mb-3">
                  Dartmouth students who aren&apos;t DALI members. They sign in
                  with Dartmouth and get the same management access for this
                  offering.
                </p>

                {externalInstructors.length > 0 && (
                  <ul className="flex flex-col gap-1.5 mb-3">
                    {externalInstructors.map((x) => (
                      <li
                        key={x.userId}
                        className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground"
                      >
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <Avatar name={x.name} size="xs" />
                          <span className="truncate">{x.name}</span>
                          <span className="rounded bg-accent-coral/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-coral">
                            External
                          </span>
                        </span>
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="remove-external-instructor"
                          />
                          <input type="hidden" name="userId" value={x.userId} />
                          <button
                            type="submit"
                            aria-label={`Remove ${x.name}`}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </Form>
                      </li>
                    ))}
                  </ul>
                )}

                <Form
                  method="post"
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                >
                  <input
                    type="hidden"
                    name="intent"
                    value="invite-external-instructor"
                  />
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                    <input
                      name="firstName"
                      required
                      placeholder="First name"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                    />
                    <input
                      name="lastName"
                      required
                      placeholder="Last name"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                    />
                    <input
                      name="netId"
                      required
                      placeholder="NetID"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 sm:max-w-[8rem]"
                    />
                  </div>
                  <Button type="submit" variant="secondary" size="sm">
                    Invite
                  </Button>
                </Form>
              </section>
            </>
          )}

          <section className="bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">
              Decision emails
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Pick a template to email applicants when their status changes.
              Unbound statuses fall back to a short built-in message.
              Templates are shared across areas — manage them in{" "}
              <Link to="/admin/email-templates" className="underline">
                Admin → Email Templates
              </Link>
              . <code className="text-[11px]">{"{{domain}}"}</code> carries the
              offering title.
            </p>
            <div className="flex flex-col gap-3">
              {(["Approved", "Waitlisted", "Rejected"] as const).map((status) => (
                <DecisionEmailRow
                  key={status}
                  status={status}
                  boundVersionId={
                    decisionEmailBindings.find((b) => b.status === status)
                      ?.emailTemplateVersionId ?? ""
                  }
                  emailTemplates={emailTemplates}
                  builtinCopy={builtinDecisionCopy[status]}
                  offeringTitle={offering.title}
                />
              ))}
            </div>
          </section>

          <section className="bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">
              Feedback forms
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Bind published forms from the Forms system. Session feedback is
              requested automatically from everyone marked Present; the exit
              survey goes to instructors at close-out.
            </p>
            <div className="flex flex-col gap-3">
              {(
                [
                  { slot: "session-feedback", label: "Session feedback" },
                  { slot: "instructor-exit", label: "Instructor exit survey" },
                ] as const
              ).map(({ slot, label }) => (
                <Form key={slot} method="post" className="flex items-center gap-3">
                  <input type="hidden" name="intent" value="set-form-binding" />
                  <input type="hidden" name="slot" value={slot} />
                  <span className="text-sm text-foreground w-44">{label}</span>
                  <Select
                    name="formId"
                    defaultValue={
                      feedbackBindings.find((b) => b.slot === slot)?.formId ?? ""
                    }
                    placeholder="None"
                    options={[
                      { value: "", label: "None" },
                      ...publishedForms.map((f) => ({ value: f.id, label: f.name })),
                    ]}
                    buttonClassName="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
                  />
                  <Button type="submit" variant="secondary" size="sm">
                    Save
                  </Button>
                </Form>
              ))}
            </div>
          </section>

          {core && offering.status === "Draft" && (
            <Form
              method="post"
              onSubmit={confirmSubmit({
                title: "Delete this draft offering?",
                description: "This can't be undone.",
                confirmLabel: "Delete",
                tone: "destructive",
              })}
            >
              <input type="hidden" name="intent" value="delete-offering" />
              <Button type="submit" variant="destructive" size="sm">
                Delete draft
              </Button>
            </Form>
          )}
        </div>
      )}

      {tab === "sessions" && (
        <div className="flex flex-col gap-4">
          {offering.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No sessions yet.{" "}
              {offering.type === "Miniseries"
                ? "A miniseries needs at least one session before it can publish."
                : "Add the workshop's session below."}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {offering.sessions.map((s) => (
                <li key={s.id} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <p className="text-sm font-semibold text-foreground">
                      {s.title ? `${s.sequence}. ${s.title}` : `Session ${s.sequence}`}
                      <span className="ml-2 font-normal text-muted-foreground text-xs">
                        {formatDateTime(s.datetime, tz)}
                      </span>
                    </p>
                    <Form
                      method="post"
                      onSubmit={confirmSubmit({
                        title: "Delete this session?",
                        confirmLabel: "Delete",
                        tone: "destructive",
                      })}
                    >
                      <input type="hidden" name="intent" value="delete-session" />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Delete
                      </Button>
                    </Form>
                  </div>
                  {/* Topic leads on its own line: it's the session's name and
                      the longest thing you type here, so sharing a row with
                      three short fields left it a stub. */}
                  <Form method="post" className="flex flex-col gap-3">
                    <input type="hidden" name="intent" value="update-session" />
                    <input type="hidden" name="sessionId" value={s.id} />
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">Topic</span>
                      <input
                        type="text"
                        name="title"
                        placeholder="e.g. Intro to Figma"
                        defaultValue={s.title ?? ""}
                        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">When</span>
                      <DateField
                        mode="datetime-local"
                        name="datetime"
                        required
                        defaultValue={toDatetimeLocal(s.datetime)}
                        className="mt-1 w-full"
                        ariaLabel="Session date and time"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">Location</span>
                      <input
                        type="text"
                        name="location"
                        defaultValue={s.location ?? ""}
                        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">Recording URL</span>
                      <input
                        type="url"
                        name="recordingUrl"
                        defaultValue={s.recordingUrl ?? ""}
                        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    </div>
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Notes for students
                      </span>
                      <textarea
                        name="notes"
                        rows={2}
                        defaultValue={s.notes ?? ""}
                        placeholder="Prep work, what to bring, links — students see this on the course page."
                        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    <div className="flex justify-end">
                      <Button type="submit" variant="secondary" size="sm">
                        Save
                      </Button>
                    </div>
                  </Form>
                </li>
              ))}
            </ul>
          )}

          {/* Adding a session is occasional; the form sat open permanently above
              the list you actually came to read. The button reveals it. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={addSessionOpen ? "secondary" : "primary"}
              onClick={() => setAddSessionOpen((o) => !o)}
            >
              Add session
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setGenerateOpen((o) => !o)}
            >
              Generate weekly series
            </Button>
          </div>

          <AddFormModal
            open={addSessionOpen}
            onClose={() => setAddSessionOpen(false)}
            title="Add session"
            intent="add-session"
            submitLabel="Add session"
          >
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">Topic</span>
              <input
                type="text"
                name="title"
                placeholder="e.g. Intro to Figma"
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">When</span>
                <DateField
                  mode="datetime-local"
                  name="datetime"
                  required
                  className="mt-1 w-full"
                  ariaLabel="Session date and time"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">Location</span>
                <input
                  type="text"
                  name="location"
                  placeholder="Sudikoff 007"
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">
                Notes for students
              </span>
              <textarea
                name="notes"
                rows={2}
                placeholder="Prep work, what to bring, links — students see this on the course page."
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </label>
          </AddFormModal>

          <AddFormModal
            open={generateOpen}
            onClose={() => setGenerateOpen(false)}
            title="Generate a weekly series"
            subtitle="You can rename or retime individual sessions afterward."
            intent="generate-sessions"
            submitLabel="Generate"
          >
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">First session</span>
              <DateField
                mode="datetime-local"
                name="startDatetime"
                required
                className="mt-1 w-full"
                ariaLabel="First session date and time"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">How many</span>
                <input
                  type="number"
                  name="count"
                  min={1}
                  max={30}
                  defaultValue={6}
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">Every N days</span>
                <input
                  type="number"
                  name="intervalDays"
                  min={1}
                  max={30}
                  defaultValue={7}
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">Location</span>
              <input
                type="text"
                name="location"
                placeholder="Sudikoff 007"
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </label>
          </AddFormModal>
        </div>
      )}

      {tab === "applications" && (
        <div className="flex flex-col gap-3">
          {applications.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No applications yet.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {(["all", "Submitted", "Approved", "Waitlisted", "Rejected", "Withdrawn"] as const)
                  .filter((s) => s === "all" || (appCounts[s] ?? 0) > 0)
                  .map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAppFilter(s)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        appFilter === s
                          ? "bg-accent-coral text-white"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s === "all" ? `All ${applications.length}` : `${s} ${appCounts[s] ?? 0}`}
                    </button>
                  ))}
                {(appCounts["Submitted"] ?? 0) > 0 && (
                  <Form method="post" className="ml-auto">
                    <input type="hidden" name="intent" value="approve-all-pending" />
                    <Button type="submit" size="sm">
                      Approve all {appCounts["Submitted"]} pending
                    </Button>
                  </Form>
                )}
              </div>
              <ApplicationsReview
                applications={filteredApps}
                statusChip={(status) => <MyStatusChip status={status as never} />}
                formatSubmitted={(at) => formatDateTime(at as never, tz)}
              />
            </>
          )}
        </div>
      )}

      {tab === "roster" && (
        <div className="flex flex-col gap-4">
          <RosterMatrix
            sessions={attendanceMatrix.sessions.map((s) => ({
              id: s.id,
              sequence: s.sequence,
              datetime: s.datetime,
            }))}
            students={attendanceMatrix.students}
            activeSessionId={roster?.session.id ?? attendanceMatrix.sessions[0]?.id ?? null}
            onSelectSession={(sessionId) =>
              setSearchParams(
                { tab: "roster", session: sessionId },
                { preventScrollReset: true },
              )
            }
            formatSessionDate={(d) => formatDateTime(d as never, tz)}
          />
        </div>
      )}

      {tab === "materials" && (
        <ManageMaterials materials={materials} workspaceDocs={workspaceDocs} favoriteIds={favoriteIds} />
      )}

      {tab === "assignments" && (
        <ManageAssignments
          assignments={assignments}
          sessions={offering.sessions.map((s) => ({ id: s.id, sequence: s.sequence }))}
          collabToken={collabToken}
          userName={userName}
        />
      )}

      {tab === "announcements" && (
        <OfferingDiscussion posts={announcements} currentUserId={currentUserId} canAnnounce />
      )}

      {tab === "feedback" && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              Session
            </span>
            <Select
              value={feedbackSessionId ?? ""}
              onChange={(value) =>
                setSearchParams(
                  { tab: "feedback", session: value },
                  { preventScrollReset: true },
                )
              }
              options={offering.sessions.map((s) => ({
                value: s.id,
                label: `Session ${s.sequence} — ${formatDateTime(s.datetime, tz)}`,
              }))}
              buttonClassName="rounded-md border border-border bg-card px-2 py-1.5 text-sm inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
          </div>

          {!sessionFeedback ? (
            <p className="text-sm text-muted-foreground italic">
              No session-feedback form is bound yet — pick one on the Details
              tab.
            </p>
          ) : (
            <FeedbackResults
              title={`Session feedback (${sessionFeedback.submissions.length} response${sessionFeedback.submissions.length === 1 ? "" : "s"})`}
              anonymizedNote={!core}
              results={sessionFeedback}
            />
          )}

          {core && exitFeedback && (
            <FeedbackResults
              title={`Instructor exit surveys (${exitFeedback.submissions.length})`}
              anonymizedNote={false}
              results={exitFeedback}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FeedbackResults({
  title,
  anonymizedNote,
  results,
}: {
  title: string;
  anonymizedNote: boolean;
  results: {
    responded: number;
    eligible: number;
    questions: { key: string; type: string; data: { label: string } }[];
    submissions: {
      id: string;
      answers: Record<string, unknown>;
      submitterName: string | null;
    }[];
  };
}) {
  const visibleQuestions = results.questions.filter((q) => q.type !== "info");
  const rate =
    results.eligible > 0
      ? Math.round((results.responded / results.eligible) * 100)
      : null;
  return (
    <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {rate !== null && (
          <p className="text-xs font-medium text-muted-foreground mt-0.5">
            {results.responded} of {results.eligible} responded ({rate}%)
          </p>
        )}
        {anonymizedNote && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Responses are anonymized and shown in a shuffled order.
          </p>
        )}
      </div>
      {results.submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No responses yet.</p>
      ) : anonymizedNote && results.responded < 3 ? (
        <p className="text-sm text-muted-foreground italic">
          Only {results.responded} response{results.responded === 1 ? "" : "s"} so far —
          individual responses stay hidden until at least 3, to keep them anonymous.
        </p>
      ) : (
        visibleQuestions.map((q) => {
          // Aggregate answers: a tally for enumerable (choice/rating) questions
          // and an average when every answer is numeric. Skipped for free text
          // (too many distinct values).
          const values = results.submissions
            .map((s) => {
              const raw = s.answers[q.key];
              return raw == null || raw === ""
                ? null
                : Array.isArray(raw)
                  ? raw.join(", ")
                  : String(raw);
            })
            .filter((v): v is string => v !== null);
          const tally = new Map<string, number>();
          for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
          const nums = values.map(Number).filter((n) => Number.isFinite(n));
          const avg =
            values.length > 0 && nums.length === values.length
              ? nums.reduce((a, b) => a + b, 0) / nums.length
              : null;
          const showTally = tally.size > 0 && tally.size <= 8;
          return (
          <div key={q.key}>
            <h3 className="text-xs font-semibold text-muted-foreground">
              {q.data.label}
            </h3>
            {(avg !== null || showTally) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {avg !== null && (
                  <span className="font-semibold text-foreground">avg {avg.toFixed(1)}</span>
                )}
                {avg !== null && showTally && " · "}
                {showTally &&
                  [...tally.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([v, n]) => `${v} (${n})`)
                    .join(", ")}
              </p>
            )}
            <ul className="mt-1 flex flex-col gap-1">
              {results.submissions.map((s) => {
                const raw = s.answers[q.key];
                const value =
                  raw == null || raw === ""
                    ? null
                    : Array.isArray(raw)
                      ? raw.join(", ")
                      : String(raw);
                if (value === null) return null;
                return (
                  <li
                    key={s.id}
                    className="text-sm text-foreground border-l-2 border-border pl-3 whitespace-pre-wrap"
                  >
                    {value}
                    {s.submitterName && (
                      <span className="text-xs text-muted-foreground"> — {s.submitterName}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })
      )}
    </section>
  );
}

// One row of the Decision emails table: bind a template (or fall back to the
// built-in copy) for a status, with a live preview of exactly what sends —
// rendered with a sample recipient so the built-in fallback isn't invisible.
function DecisionEmailRow({
  status,
  boundVersionId,
  emailTemplates,
  builtinCopy,
  offeringTitle,
}: {
  status: "Approved" | "Waitlisted" | "Rejected";
  boundVersionId: string;
  emailTemplates: { name: string; versionId: string; subject: string; body: string }[];
  builtinCopy: { subject: string; body: string };
  offeringTitle: string;
}) {
  const [selected, setSelected] = useState(boundVersionId);
  const [showPreview, setShowPreview] = useState(false);

  const source = selected
    ? emailTemplates.find((t) => t.versionId === selected) ?? builtinCopy
    : builtinCopy;
  // Sample render: {{firstName}} → a placeholder name, {{domain}} → the offering
  // title (education templates carry the title in {{domain}}), matching the send.
  const preview = renderEmail(source, { firstName: "Alex", domain: offeringTitle });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 p-2">
      <Form method="post" className="flex items-center gap-3">
        <input type="hidden" name="intent" value="set-decision-email" />
        <input type="hidden" name="status" value={status} />
        <span className="text-sm text-foreground w-24">{status}</span>
        <Select
          name="emailTemplateVersionId"
          value={selected}
          onChange={setSelected}
          placeholder="Built-in message (no template)"
          options={[
            { value: "", label: "Built-in message (no template)" },
            ...emailTemplates.map((t) => ({ value: t.versionId, label: t.name })),
          ]}
          buttonClassName="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
        />
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors shrink-0"
        >
          {showPreview ? "Hide" : "Preview"}
        </button>
        <Button type="submit" variant="secondary" size="sm">
          Save
        </Button>
      </Form>
      {showPreview && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
          <p className="text-muted-foreground">
            {selected ? "Bound template" : "Built-in message"} — sample for “Alex”:
          </p>
          <p className="mt-1 font-medium text-foreground">{preview.subject}</p>
          <div
            className="mt-1 text-foreground [&_p]:my-1"
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        </div>
      )}
    </div>
  );
}
