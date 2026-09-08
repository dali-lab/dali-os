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
import { isCore, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { requireOfferingManager } from "~/education/lib/access.server";
import { getOfferingDetail } from "~/education/lib/offerings.server";
import { runManageAction } from "~/education/lib/manage-actions.server";
import { listApplications } from "~/education/lib/apply.server";
import { ApplicationAnswers } from "~/education/components/ApplicationAnswers";
import { ApplicationsReview } from "~/education/components/ApplicationsReview";
import { RosterMatrix } from "~/education/components/RosterMatrix";
import { InstructorPicker } from "~/education/components/InstructorPicker";
import { AddFormModal } from "~/education/components/AddFormModal";
import { OfferingDiscussion } from "~/education/components/OfferingDiscussion";
import {
  listMaterialPages,
  listWorkspaceDocs,
} from "~/education/lib/lms.server";
import QRCode from "qrcode";
import { isSessionCheckInOpen } from "~/education/lib/session-checkin.server";
import {
  listAssignments,
  getPerformanceByApplication,
} from "~/education/lib/assignments.server";
import { listDiscussion } from "~/education/lib/announcements.server";
import { builtinDecisionEmail } from "~/education/lib/notifications.server";
import {
  getAttendanceMatrix,
  getSessionRoster,
} from "~/education/lib/attendance.server";
import { notesForOffering } from "~/education/lib/student-notes.server";
import { certificateEligibility } from "~/education/lib/certificates.server";
import {
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
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";
import { Button, buttonClasses } from "~/components/ui/Button";
import { Avatar } from "~/components/ui/Avatar";
import { DriveFolderBindings } from "~/components/drive/DriveFolderBindings";
import { X } from "lucide-react";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { TypeBadge, StatusBadge, MyStatusChip } from "~/education/components/OfferingCard";
import { OfferingFields, toDatetimeLocal } from "~/education/components/OfferingFields";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { DateField } from "~/components/ui/DateField";
import { formatDateTime, formatSessionWhen } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { cn } from "~/lib/cn";
import { InfoTip } from "~/components/ui/floating";
import { DecisionEmailRow } from "~/education/components/DecisionEmailRow";
import { FeedbackResults } from "~/education/components/FeedbackResults";

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

  // Redesign: the manage surface folds into the course page (Editing mode).
  // The action below stays live either way — fetcher POSTs never run loaders.
  const roles = await getUserRoles(gate.auth.user.sub, request);
  if (await isFeatureEnabled("education-redesign", gate.auth.user.sub, roles, request)) {
    return redirect(
      gate.auth.user.type === "dartmouth"
        ? `/portal/education/${params.offeringId}/hub`
        : `/education/${params.offeringId}/hub`,
    );
  }

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering) throw new Response("Not found", { status: 404 });

  // Roster tab: ?session= picks the session, defaulting to the first one.
  const requestedSessionId = new URL(request.url).searchParams.get("session");
  const rosterSessionId = requestedSessionId ?? offering.sessions[0]?.id ?? null;
  const roster = rosterSessionId
    ? await getSessionRoster(params.offeringId!, rosterSessionId)
    : null;

  // Self-check-in for the selected session: its open state + a QR the instructor
  // projects for students to scan. One QR (just the selected session), so this
  // stays cheap regardless of how many sessions the offering has.
  const rosterSession = rosterSessionId
    ? offering.sessions.find((s) => s.id === rosterSessionId) ?? null
    : null;
  const checkInUrl = rosterSession
    ? `${new URL(request.url).origin}/education/check-in/${rosterSession.id}`
    : null;
  const checkInQrSvg = checkInUrl
    ? await QRCode.toString(checkInUrl, { type: "svg", margin: 1, width: 200 })
    : null;
  const sessionCheckIn = rosterSession
    ? {
        sessionId: rosterSession.id,
        open: isSessionCheckInOpen(rosterSession),
        checkInUrl,
        checkInQrSvg,
      }
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
          // Any lab member is eligible as an instructor — not just those active
          // in the current term. Alums, future-term members, and anyone not
          // staffed this cycle should still be addable.
          where: { daliMember: { isNot: null } },
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

  // Uploaded file materials for this offering (S3-backed, not Page records).
  const offeringFiles = await prisma.projectFile.findMany({
    where: {
      workspaceType: "EducationOffering",
      workspaceId: params.offeringId!,
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, folderPageId: true },
  });

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

  // Performance view: grades/scores keyed by (applicationId → assignmentId)
  // for the approved roster. Shared with the redesign People surface.
  const performanceByApp = await getPerformanceByApplication(
    params.offeringId!,
    assignments.map((a) => a.id),
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
    sessionCheckIn,
    attendanceMatrix,
    // Performance view data (plain — no Prisma types, safe to pass to client).
    performanceByApp,
    assignmentsForPerformance: assignments.map((a) => ({
      id: a.id,
      title: a.title,
      points: a.points,
    })),
    // Pre-computed completion eligibility per student (attendance-driven; scores are informational).
    completionByApp: Object.fromEntries(
      attendanceMatrix.students.map((st) => {
        const present = Object.values(st.marks).filter((m) => m === "Present").length;
        const excused = Object.values(st.marks).filter((m) => m === "Excused").length;
        return [
          st.applicationId,
          certificateEligibility({
            type: offering.type as "Miniseries" | "Workshop",
            totalSessions: attendanceMatrix.sessions.length,
            present,
            excused,
            threshold: offering.completionThreshold,
          }),
        ];
      }),
    ),
    materials,
    offeringFiles: offeringFiles.map((f) => ({
      id: f.id,
      title: f.title,
      folderPageId: f.folderPageId,
      href: `/documents/file/${f.id}`,
    })),
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

  const result = await runManageAction(formData, {
    offeringId: params.offeringId!,
    actorId: auth.user.sub,
  });
  if (result instanceof Response) return result;
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

// Weekday chips for the "Generate a session series" picker. Index === JS
// getDay() (0 = Sunday), so the checkbox value maps straight to the weekday the
// server schedules on.
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export default function ManageOffering() {
  const {
    offering,
    applications,
    roster,
    sessionCheckIn,
    attendanceMatrix,
    materials,
    offeringFiles,
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
    performanceByApp,
    assignmentsForPerformance,
    completionByApp,
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

  // Per-session rollups so the Sessions tab connects to the rest of the offering
  // (attendance, materials, assignments) instead of being a bare date list.
  const totalRosterStudents = attendanceMatrix.students.length;
  const presentBySession = new Map<string, number>();
  for (const s of attendanceMatrix.sessions) {
    presentBySession.set(
      s.id,
      attendanceMatrix.students.filter((st) => st.marks[s.id] === "Present").length,
    );
  }
  const materialsBySession = new Map<string, { id: string; title: string }[]>();
  for (const top of materials) {
    for (const m of [top, ...top.children]) {
      if (!m.sessionId) continue;
      const list = materialsBySession.get(m.sessionId) ?? [];
      list.push({ id: m.id, title: m.title });
      materialsBySession.set(m.sessionId, list);
    }
  }
  const assignmentsBySession = new Map<string, { id: string; title: string }[]>();
  for (const a of assignments) {
    if (!a.sessionId) continue;
    const list = assignmentsBySession.get(a.sessionId) ?? [];
    list.push({ id: a.id, title: a.title });
    assignmentsBySession.set(a.sessionId, list);
  }

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
          <Link
            to={`/education/${offering.id}/hub?as=student`}
            className={buttonClasses("ghost", "sm")}
          >
            View as student
          </Link>
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

          <DriveFolderBindings
            processType="EducationOffering"
            processId={offering.id}
            className="bg-card border border-border rounded-lg p-5"
          />

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
                  {
                    slot: "session-feedback",
                    label: "Session feedback",
                    tip: "Sent automatically to everyone marked Present after each session. Results are visible to the instructor and Core members.",
                  },
                  {
                    slot: "instructor-exit",
                    label: "Instructor exit survey",
                    tip: "Sent to instructors when the offering is closed out. Used to capture end-of-course reflections — separate from the per-session feedback students receive.",
                  },
                ] as const
              ).map(({ slot, label, tip }) => (
                <Form key={slot} method="post" className="flex items-center gap-3">
                  <input type="hidden" name="intent" value="set-form-binding" />
                  <input type="hidden" name="slot" value={slot} />
                  <span className="text-sm text-foreground w-44 inline-flex items-center gap-1">
                    {label}
                    <InfoTip content={tip} />
                  </span>
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
                        {formatSessionWhen(s.datetime, s.endsAt, tz)}
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
                    <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">Starts</span>
                      <DateField
                        mode="datetime-local"
                        name="datetime"
                        required
                        defaultValue={toDatetimeLocal(s.datetime)}
                        className="mt-1 w-full"
                        ariaLabel="Session start date and time"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">Ends</span>
                      <DateField
                        mode="datetime-local"
                        name="endsAt"
                        defaultValue={s.endsAt ? toDatetimeLocal(s.endsAt) : ""}
                        className="mt-1 w-full"
                        ariaLabel="Session end date and time"
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
                  {/* What this session connects to — attendance, materials and
                      assignments — so the tab isn't just a bare date list. */}
                  <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-xs">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-muted-foreground">
                        {totalRosterStudents > 0
                          ? `${presentBySession.get(s.id) ?? 0} of ${totalRosterStudents} present`
                          : "No enrolled students yet"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSearchParams({ tab: "roster", session: s.id })}
                        className="font-medium text-accent-teal hover:underline"
                      >
                        Take attendance →
                      </button>
                    </div>
                    {(materialsBySession.get(s.id)?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <span className="text-muted-foreground">Materials:</span>
                        {materialsBySession.get(s.id)!.map((m) => (
                          <a
                            key={m.id}
                            href={`/documents/${m.id}`}
                            className="text-foreground hover:text-accent-coral hover:underline"
                          >
                            {m.title}
                          </a>
                        ))}
                      </div>
                    )}
                    {(assignmentsBySession.get(s.id)?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <span className="text-muted-foreground">Assignments:</span>
                        {assignmentsBySession.get(s.id)!.map((a) => (
                          <a
                            key={a.id}
                            href={`/education/manage/assignments/${a.id}`}
                            className="text-foreground hover:text-accent-coral hover:underline"
                          >
                            {a.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
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
                <span className="text-xs font-semibold text-muted-foreground">Starts</span>
                <DateField
                  mode="datetime-local"
                  name="datetime"
                  required
                  className="mt-1 w-full"
                  ariaLabel="Session start date and time"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">Ends</span>
                <DateField
                  mode="datetime-local"
                  name="endsAt"
                  className="mt-1 w-full"
                  ariaLabel="Session end date and time"
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
            title="Generate a session series"
            subtitle="Pick the weekdays this class meets — a Mon/Wed class fills in both, in date order. Rename or retime any session afterward."
            intent="generate-sessions"
            submitLabel="Generate"
          >
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">Starting the week of</span>
              <DateField
                mode="date"
                name="startDate"
                required
                className="mt-1 w-full"
                ariaLabel="Series start date"
              />
            </label>
            <div className="block">
              <span className="text-xs font-semibold text-muted-foreground">Meets on</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {WEEKDAYS.map((label, i) => (
                  <label
                    key={i}
                    className="relative cursor-pointer select-none"
                    title={WEEKDAY_NAMES[i]}
                  >
                    <input
                      type="checkbox"
                      name="weekdays"
                      value={i}
                      className="peer sr-only"
                    />
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-sm font-medium text-muted-foreground transition-colors peer-checked:border-accent-coral peer-checked:bg-accent-coral peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent-coral/40">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">Starts</span>
                <DateField
                  mode="time"
                  name="startTime"
                  required
                  className="mt-1 w-full"
                  ariaLabel="Session start time"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">Ends</span>
                <DateField
                  mode="time"
                  name="endTime"
                  className="mt-1 w-full"
                  ariaLabel="Session end time"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground"># of weeks</span>
                <input
                  type="number"
                  name="weeks"
                  min={1}
                  max={26}
                  defaultValue={6}
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
          {sessionCheckIn && (
            <section className="bg-card border border-border rounded-lg p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-heading font-semibold text-foreground">Self check-in</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground max-w-md">
                    Open check-in and project the QR — enrolled students scan it to mark
                    themselves present, instead of you calling the roll. You can still mark anyone
                    by hand below.
                  </p>
                </div>
                <Form method="post" className="shrink-0">
                  <input type="hidden" name="intent" value="set-session-check-in" />
                  <input type="hidden" name="sessionId" value={sessionCheckIn.sessionId} />
                  <input type="hidden" name="open" value={sessionCheckIn.open ? "false" : "true"} />
                  <Button type="submit" size="sm" variant={sessionCheckIn.open ? "secondary" : "primary"}>
                    {sessionCheckIn.open ? "Close check-in" : "Open self check-in"}
                  </Button>
                </Form>
              </div>
              {sessionCheckIn.open && sessionCheckIn.checkInQrSvg && sessionCheckIn.checkInUrl && (
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <div
                    className="w-40 h-40 shrink-0 rounded-md bg-white p-2 [&_svg]:w-full [&_svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: sessionCheckIn.checkInQrSvg }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      Check-in is open for this session.
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Students scan the code (signed in) to mark themselves present. Marks appear in
                      the roster below.
                    </p>
                    <a
                      href={sessionCheckIn.checkInUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs text-accent-teal hover:underline break-all"
                    >
                      {sessionCheckIn.checkInUrl}
                    </a>
                  </div>
                </div>
              )}
            </section>
          )}
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
            assignments={assignmentsForPerformance}
            submissionsByApp={performanceByApp}
            completionByApp={completionByApp}
          />
        </div>
      )}

      {tab === "materials" && (
        <ManageMaterials
          offeringId={offering.id}
          materials={materials}
          files={offeringFiles}
          workspaceDocs={workspaceDocs}
          sessions={offering.sessions.map((s) => ({ id: s.id, sequence: s.sequence }))}
          favoriteIds={favoriteIds}
        />
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

