import { useState } from "react";
import {
  redirect,
  useLoaderData,
  useActionData,
  useSearchParams,
  Form,
  Link,
} from "react-router";
import type { Route } from "./+types/education.manage.$offeringId";
import { requireAuth } from "~/lib/auth";
import { isCore, currentTermMemberWhere } from "~/lib/roles";
import {
  requireOfferingManager,
  redirectDartmouthToPortal,
} from "~/education/lib/access.server";
import {
  getOfferingDetail,
  runOfferingAction,
} from "~/education/lib/offerings.server";
import { listApplications } from "~/education/lib/apply.server";
import { decideApplication, approveAllPending } from "~/education/lib/decisions.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { ApplicationAnswers } from "~/education/components/ApplicationAnswers";
import { listMaterialPages, listWorkspaceDocs, createMaterialPage } from "~/education/lib/lms.server";
import {
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
} from "~/education/lib/assignments.server";
import { listAnnouncements, postAnnouncement } from "~/education/lib/announcements.server";
import { getSessionRoster, saveAttendance } from "~/education/lib/attendance.server";
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
import { useConfirmSubmit } from "~/components/ui/dialog";
import { TypeBadge, StatusBadge, MyStatusChip } from "~/education/components/OfferingCard";
import { OfferingFields, toDatetimeLocal } from "~/education/components/OfferingFields";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
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
  if (!authOrRedirect.ok) return redirect("/login");
  const portalRedirect = redirectDartmouthToPortal(authOrRedirect);
  if (portalRedirect) return portalRedirect;

  const gate = await requireOfferingManager(request, params.offeringId!);
  if (!gate.ok) return redirect("/education");

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
          select: { id: true, versionNumber: true },
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
    listAnnouncements(params.offeringId!),
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
    materials,
    workspaceDocs,
    assignments,
    announcements: announcements.map((a) => ({
      id: a.id,
      body: a.body,
      sentAt: a.sentAt,
      authorName: `${a.author.firstName} ${a.author.lastName}`.trim(),
    })),
    emailTemplates: emailTemplates
      .filter((t) => t.versions.length > 0)
      .map((t) => ({ name: t.name, versionId: t.versions[0]!.id })),
    decisionEmailBindings,
    isCore: core,
    instructorCandidates: instructorCandidates.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
    })),
    collabToken: parseSessionCookie(request),
    userName: `${gate.auth.user.firstName ?? ""} ${gate.auth.user.lastName ?? ""}`.trim(),
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
      case "create-page": {
        const result = await createMaterialPage({
          offeringId: params.offeringId!,
          title: String(formData.get("title") ?? ""),
          parentPageId: String(formData.get("parentPageId") ?? "") || null,
          studentEditable: formData.get("studentEditable") === "true",
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
  return result;
}

const TABS = [
  { key: "details", label: "Details" },
  { key: "sessions", label: "Sessions" },
  { key: "applications", label: "Applications" },
  { key: "roster", label: "Roster" },
  { key: "materials", label: "Materials" },
  { key: "assignments", label: "Assignments" },
  { key: "announcements", label: "Announcements" },
  { key: "feedback", label: "Feedback" },
] as const;

export default function ManageOffering() {
  const {
    offering,
    applications,
    roster,
    materials,
    workspaceDocs,
    assignments,
    announcements,
    emailTemplates,
    decisionEmailBindings,
    publishedForms,
    feedbackBindings,
    sessionFeedback,
    exitFeedback,
    feedbackSessionId,
    isCore: core,
    instructorCandidates,
    collabToken,
    userName,
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
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={offering.type} />
            <StatusBadge status={offering.status} />
          </div>
          <h1 className="mt-1 font-heading text-2xl font-bold text-foreground">
            {offering.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {offering.approvedCount} of {offering.capacity} seats filled
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/education/${offering.id}`}
            className={buttonClasses("ghost", "sm")}
          >
            View listing
          </Link>
          <Form method="post">
            <input type="hidden" name="intent" value="preview-close-out" />
            <Button type="submit" variant="ghost" size="sm">
              Preview close-out
            </Button>
          </Form>
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
        <div className="flex flex-col gap-6 max-w-2xl">
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
            <div>
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
                <CollaborativeEditor
                  editorId={offering.descriptionDocId}
                  documentName={offering.descriptionDocId}
                  token={collabToken}
                  userName={userName}
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
              <div className="grid gap-1 sm:grid-cols-2 max-h-64 overflow-y-auto pr-2">
                {instructorCandidates.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      name="userIds"
                      value={u.id}
                      defaultChecked={offering.instructors.some((i) => i.userId === u.id)}
                      className="rounded border-border"
                    />
                    {u.name}
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <Button type="submit" variant="secondary" size="sm">
                  Save instructors
                </Button>
              </div>
            </Form>
          )}

          <section className="bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">
              Decision emails
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Pick a template to email applicants when their status changes.
              Unbound statuses fall back to a short built-in message.
              Templates are shared across areas — manage them in{" "}
              <Link to="/admin-console/email-templates" className="underline">
                Admin → Email Templates
              </Link>
              . <code className="text-[11px]">{"{{domain}}"}</code> carries the
              offering title.
            </p>
            <div className="flex flex-col gap-3">
              {(["Approved", "Waitlisted", "Rejected"] as const).map((status) => (
                <Form
                  key={status}
                  method="post"
                  className="flex items-center gap-3"
                >
                  <input type="hidden" name="intent" value="set-decision-email" />
                  <input type="hidden" name="status" value={status} />
                  <span className="text-sm text-foreground w-24">{status}</span>
                  <select
                    name="emailTemplateVersionId"
                    defaultValue={
                      decisionEmailBindings.find((b) => b.status === status)
                        ?.emailTemplateVersionId ?? ""
                    }
                    className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                  >
                    <option value="">Built-in message (no template)</option>
                    {emailTemplates.map((t) => (
                      <option key={t.versionId} value={t.versionId}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="secondary" size="sm">
                    Save
                  </Button>
                </Form>
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
                  <select
                    name="formId"
                    defaultValue={
                      feedbackBindings.find((b) => b.slot === slot)?.formId ?? ""
                    }
                    className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                  >
                    <option value="">None</option>
                    {publishedForms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
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
        <div className="flex flex-col gap-4 max-w-2xl">
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
                  <Form method="post" className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] items-end">
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
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">When</span>
                      <input
                        type="datetime-local"
                        name="datetime"
                        required
                        defaultValue={toDatetimeLocal(s.datetime)}
                        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
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
                    <Button type="submit" variant="secondary" size="sm">
                      Save
                    </Button>
                  </Form>
                </li>
              ))}
            </ul>
          )}

          <Form
            method="post"
            className="bg-card border border-border rounded-lg p-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] items-end"
          >
            <input type="hidden" name="intent" value="add-session" />
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">Topic</span>
              <input
                type="text"
                name="title"
                placeholder="e.g. Intro to Figma"
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">When</span>
              <input
                type="datetime-local"
                name="datetime"
                required
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
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
            <Button type="submit" size="sm">
              Add session
            </Button>
          </Form>

          <details className="bg-card border border-border rounded-lg p-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              Generate a weekly series
            </summary>
            <Form
              method="post"
              className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto_1fr_auto] items-end"
            >
              <input type="hidden" name="intent" value="generate-sessions" />
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">First session</span>
                <input
                  type="datetime-local"
                  name="startDatetime"
                  required
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">How many</span>
                <input
                  type="number"
                  name="count"
                  min={1}
                  max={30}
                  defaultValue={6}
                  className="mt-1 w-20 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
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
                  className="mt-1 w-20 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
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
              <Button type="submit" variant="secondary" size="sm">
                Generate
              </Button>
            </Form>
            <p className="mt-2 text-xs text-muted-foreground">
              You can rename/retime individual sessions afterward.
            </p>
          </details>
        </div>
      )}

      {tab === "applications" && (
        <div className="flex flex-col gap-3 max-w-3xl">
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
              {filteredApps.map((a) => (
              <details
                key={a.id}
                className="bg-card border border-border rounded-lg px-4 py-3"
              >
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none">
                  <div className="flex items-center gap-3 min-w-0">
                    <MyStatusChip status={a.status} />
                    <span className="text-sm font-medium text-foreground truncate">
                      {`${a.applicant.firstName} ${a.applicant.lastName}`.trim()}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {a.applicant.daliEmail ??
                        a.applicant.dartmouthEmail ??
                        (a.applicant.netId ? `${a.applicant.netId}@dartmouth.edu` : "")}
                    </span>
                    {a.status === "Waitlisted" && a.waitlistRank != null && (
                      <span className="text-xs text-muted-foreground">
                        #{a.waitlistRank}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDateTime(a.submittedAt, tz)}
                  </span>
                </summary>
                <div className="mt-3 pt-3 border-t border-border flex flex-col gap-4">
                  {a.formSubmission ? (
                    <ApplicationAnswers
                      questions={
                        (a.formSubmission.formVersion.questions as unknown as Question[]) ?? []
                      }
                      answers={
                        (a.formSubmission.answers as Record<string, unknown>) ?? {}
                      }
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      No answers recorded.
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    {(["Approved", "Waitlisted", "Rejected"] as const)
                      .filter((s) => s !== a.status)
                      .map((s) => (
                        <Form key={s} method="post">
                          <input type="hidden" name="intent" value="decide-application" />
                          <input type="hidden" name="applicationId" value={a.id} />
                          <input type="hidden" name="status" value={s} />
                          <Button
                            type="submit"
                            size="sm"
                            variant={s === "Approved" ? "primary" : "secondary"}
                          >
                            {s === "Approved"
                              ? "Approve"
                              : s === "Waitlisted"
                                ? "Waitlist"
                                : "Reject"}
                          </Button>
                        </Form>
                      ))}
                  </div>

                  {a.status === "Approved" && (
                    <Form
                      method="post"
                      className="grid gap-3 sm:grid-cols-2 items-start pt-3 border-t border-border"
                    >
                      <input type="hidden" name="intent" value="save-student-note" />
                      <input type="hidden" name="applicationId" value={a.id} />
                      <label className="block">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Feedback to student — shared with their certificate
                        </span>
                        <textarea
                          name="feedback"
                          rows={3}
                          defaultValue={a.note?.feedback ?? ""}
                          placeholder="Overall performance feedback the student will see…"
                          className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-amber-800">
                          Internal note — hiring only, never shown to the student
                        </span>
                        <textarea
                          name="internalNote"
                          rows={3}
                          defaultValue={a.note?.internalNote ?? ""}
                          placeholder="Engagement/competency signal for future hiring…"
                          className="mt-1 w-full rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm"
                        />
                      </label>
                      <div className="sm:col-span-2">
                        <Button type="submit" variant="secondary" size="sm">
                          Save notes
                        </Button>
                      </div>
                    </Form>
                  )}
                </div>
              </details>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "roster" && (
        <div className="flex flex-col gap-4 max-w-2xl">
          {offering.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Add a session first — attendance is marked per session.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Session
                </span>
                <select
                  value={roster?.session.id ?? ""}
                  onChange={(e) =>
                    setSearchParams(
                      { tab: "roster", session: e.target.value },
                      { preventScrollReset: true },
                    )
                  }
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                >
                  {offering.sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      Session {s.sequence} — {formatDateTime(s.datetime, tz)}
                    </option>
                  ))}
                </select>
              </div>

              {roster && roster.roster.length === 0 && (
                <p className="text-sm text-muted-foreground italic">
                  No approved students yet.
                </p>
              )}
              {roster && roster.roster.length > 0 && (
                <Form method="post" className="bg-card border border-border rounded-lg">
                  <input type="hidden" name="intent" value="save-attendance" />
                  <input type="hidden" name="sessionId" value={roster.session.id} />
                  <ul className="divide-y divide-border">
                    {roster.roster.map((r) => (
                      <li
                        key={r.applicationId}
                        className="px-4 py-2.5 flex items-center justify-between gap-4"
                      >
                        <span className="text-sm text-foreground">{r.name}</span>
                        <select
                          name={`mark-${r.applicationId}`}
                          defaultValue={r.status ?? ""}
                          className="rounded-md border border-border bg-card px-2 py-1 text-sm"
                        >
                          <option value="">Unmarked</option>
                          <option value="Present">Present</option>
                          <option value="Absent">Absent</option>
                          <option value="Excused">Excused</option>
                        </select>
                      </li>
                    ))}
                  </ul>
                  <div className="px-4 py-3 border-t border-border flex items-center gap-2">
                    <Button type="submit" size="sm">
                      Save attendance
                    </Button>
                    <button
                      type="button"
                      onClick={(e) => {
                        const form = e.currentTarget.closest("form");
                        form
                          ?.querySelectorAll<HTMLSelectElement>('select[name^="mark-"]')
                          .forEach((el) => {
                            el.value = "Present";
                          });
                      }}
                      className="text-xs font-semibold text-accent-coral hover:underline"
                    >
                      Mark all Present
                    </button>
                  </div>
                </Form>
              )}
            </>
          )}
        </div>
      )}

      {tab === "materials" && (
        <ManageMaterials materials={materials} workspaceDocs={workspaceDocs} />
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
        <ManageAnnouncements announcements={announcements} />
      )}

      {tab === "feedback" && (
        <div className="flex flex-col gap-5 max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              Session
            </span>
            <select
              value={feedbackSessionId ?? ""}
              onChange={(e) =>
                setSearchParams(
                  { tab: "feedback", session: e.target.value },
                  { preventScrollReset: true },
                )
              }
              className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            >
              {offering.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  Session {s.sequence} — {formatDateTime(s.datetime, tz)}
                </option>
              ))}
            </select>
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
      ) : (
        visibleQuestions.map((q) => (
          <div key={q.key}>
            <h3 className="text-xs font-semibold text-muted-foreground">
              {q.data.label}
            </h3>
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
        ))
      )}
    </section>
  );
}
