import { useState } from "react";
import { approveAllConfirm } from "~/education/lib/approve-all-copy";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { skipClientOnlySearchChange } from "~/lib/should-revalidate";
import { useLoaderData, useActionData, useSearchParams, Form, Link } from "react-router";
import type { Route } from "./+types/education.manage.$offeringId";
import { loadManageOffering } from "~/education/lib/manage-offering.server";
import { runManageOfferingAction } from "~/education/lib/manage-offering-actions.server";
import { ApplicationsReview, WaitlistOrder } from "~/education/components/ApplicationsReview";
import { RosterMatrix } from "~/education/components/RosterMatrix";
import { OfferingDiscussion } from "~/education/components/OfferingDiscussion";
import { ManageMaterials, ManageAssignments } from "~/education/components/ManageCourseContent";
import { Button, buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { TypeBadge, StatusBadge, MyStatusChip } from "~/education/components/OfferingCard";
import { formatDateTime, formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `Manage ${data?.offering.title ?? "Offering"} · DALI OS` },
];

export const handle = {
  // Offering pages name themselves in their own headers, so the trail above
  // them only repeated where you already are.
  hideBreadcrumbs: true,
  // The page fills the shell's main column instead of growing the document:
  // the title, badges and tab strip stay put and each tab's content scrolls
  // under them. Sessions needs it (its side nav has to stay beside the cards),
  // and every other tab reads better for it. Desktop only — below `md` the
  // shell isn't height-capped, so the page scrolls normally there.
  fitViewport: true,
  breadcrumb: (data: { offering: { title: string } } | undefined) =>
    data?.offering.title ?? "Offering",
};

// Only ?session= (the roster session) reaches the loader; ?tab= is client-only.
const LOADER_SEARCH_PARAMS = ["session"] as const;

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return skipClientOnlySearchChange(args, LOADER_SEARCH_PARAMS);
}
import { TABS, ManageSection, NOTICE_CLASS } from "~/education/components/manage/manage-ui";
import { DetailsTab } from "~/education/components/manage/DetailsTab";
import { SessionsTab } from "~/education/components/manage/SessionsTab";
import { FeedbackTab } from "~/education/components/manage/FeedbackTab";

export async function loader({ request, params }: Route.LoaderArgs) {
  return loadManageOffering(request, params.offeringId!);
}

export async function action({ request, params }: Route.ActionArgs) {
  return runManageOfferingAction(request, params.offeringId!);
}

export type ManageOfferingLoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function ManageOffering() {
  const data = useLoaderData<typeof loader>();
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
    educationEmails,
    publishedForms,
    feedbackBindings,
    sessionFeedback,
    exitFeedback,
    feedbackSessionId,
    isCore: core,
    certificateTemplates,
    certificateBinding,
    instructorCandidates,
    memberInstructorIds,
    externalInstructors,
    collabToken,
    userName,
    currentUserId,
    performanceByApp,
    assignmentsForPerformance,
    completionByApp,
  } = data;
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();
  const actionData = useActionData<{
    error?: string;
    closeOut?: { issued: number; alreadyIssued: number; ineligible: number };
    closeOutPreview?: { eligible: string[]; belowThreshold: string[]; alreadyIssued: number } | null;
    reopened?: boolean;
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

  // Publishing is a toggle. Archiving isn't a button of its own any more:
  // close-out archives, and Reopen brings it back — so a closed-out course
  // shows Reopen instead of a publish toggle that would contradict it.
  const publishToggle: { to: string; label: string; variant: "primary" | "secondary" } | null =
    offering.closedOutAt
      ? null
      : offering.status === "Published"
        ? { to: "Draft", label: "Unpublish", variant: "secondary" }
        : { to: "Published", label: "Publish", variant: "primary" };

  // Close-out completes the course (issues certificates, emails students). If it
  // hasn't finished running yet, warn hard in the confirm dialog before letting
  // an operator proceed — closing early is what strands an offering in the "Past
  // offerings" bucket before it ever happens.
  const hasEnded =
    offering.endsAt != null && new Date(offering.endsAt).getTime() < Date.now();
  const closeOutConfirm = hasEnded
    ? {
        title: "Close out this course?",
        description:
          "Certificates are issued to every approved student meeting the attendance threshold, and each gets an email. The course is archived. Re-running only issues missing certificates.",
        confirmLabel: "Close out",
      }
    : {
        title: "Close out before it's finished?",
        description: `This course ${offering.endsAt ? `runs until ${formatDateShort(offering.endsAt, tz)} and ` : ""}hasn't finished yet. Closing out now issues certificates to everyone who has already met the attendance threshold and emails them. Anyone still to attend is left out, and the course is archived. You can reopen it afterward.`,
        confirmLabel: "Close out anyway",
      };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          {/* Title first: the badges qualify the offering, so they read better
              under its name than as an eyebrow above it. */}
          <h1 className="font-heading text-4xl font-medium text-foreground">
            {offering.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <TypeBadge type={offering.type} />
            <StatusBadge status={offering.status} />
            <span className="text-sm text-os-grey">
              {offering.approvedCount} of {offering.capacity} seats filled
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/education/${offering.id}/hub?as=student`}
            className={buttonClasses("ghost", "sm")}
          >
            Student view
          </Link>
          {publishToggle && (
            <Form method="post">
              <input type="hidden" name="intent" value="set-status" />
              <input type="hidden" name="status" value={publishToggle.to} />
              <Button type="submit" variant={publishToggle.variant} size="sm">
                {publishToggle.label}
              </Button>
            </Form>
          )}
          <Form method="post" onSubmit={confirmSubmit(closeOutConfirm)}>
            <input type="hidden" name="intent" value="close-out-offering" />
            {/* The confirm dialog above warns when the course hasn't finished, so
                a submit that reaches the action is a deliberate close-out. */}
            <input type="hidden" name="allowEarly" value="true" />
            <Button type="submit" variant="secondary" size="sm">
              {offering.closedOutAt ? "Re-run close-out" : "Close out course"}
            </Button>
          </Form>
          {offering.closedOutAt && (
            <Form
              method="post"
              onSubmit={confirmSubmit({
                title: "Reopen this course?",
                description:
                  "This unarchives the course and clears the close-out, so it leaves Past offerings and can be edited and closed out again later. Certificates already issued stay valid.",
                confirmLabel: "Reopen",
              })}
            >
              <input type="hidden" name="intent" value="reopen-offering" />
              <Button type="submit" variant="ghost" size="sm">
                Reopen
              </Button>
            </Form>
          )}
        </div>
      </header>

      {actionData?.error && (
        <p className="rounded-os-item bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionData.error}
        </p>
      )}
      {actionData?.closeOut && (
        <p className={NOTICE_CLASS}>
          Close-out complete: {actionData.closeOut.issued} certificate
          {actionData.closeOut.issued === 1 ? "" : "s"} issued
          {actionData.closeOut.alreadyIssued > 0 &&
            `, ${actionData.closeOut.alreadyIssued} already issued`}
          {actionData.closeOut.ineligible > 0 &&
            `, ${actionData.closeOut.ineligible} below the attendance threshold`}
          .
        </p>
      )}
      {actionData?.reopened && (
        <p className={NOTICE_CLASS}>
          Course reopened — it's back in the active catalog and can be edited.
        </p>
      )}
      {actionData?.closeOutPreview && (
        <div className="flex flex-col gap-1 rounded-os-card bg-os-card px-5 py-4 text-sm">
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
            <p className="text-xs text-os-amber">
              Below threshold: {actionData.closeOutPreview.belowThreshold.join(", ")}
            </p>
          )}
        </div>
      )}
      {actionData?.bulkApprove && (
        <p className={NOTICE_CLASS}>
          Approved {actionData.bulkApprove.approved} pending application
          {actionData.bulkApprove.approved === 1 ? "" : "s"}
          {actionData.bulkApprove.skipped > 0 &&
            ` — ${actionData.bulkApprove.skipped} left (capacity reached)`}
          .
        </p>
      )}

      {/* Underlined tabs on the page ground: eight sections is too many for a
          filled segmented track, which stretches each one into a wide chip. */}
      {/* Every tab draws its own 2px rule and a trailing spacer carries it to
          the edge, so the underline is one continuous line. Laying the rule on
          a wrapper and pulling the row over it leaves the line half-covered
          under each tab and full-strength in the gaps between them.
          The active colour is inline because app.css sets `* { border-color }`
          outside any layer, and an unlayered rule outranks every Tailwind
          border-colour utility — see the note in the PR/summary. Inactive tabs
          take that same global default, which is the grey we want. */}
      <nav className="flex overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSearchParams({ tab: t.key }, { replace: true, preventScrollReset: true })}
            style={
              tab === t.key
                ? { borderBottomColor: "var(--color-os-accent)" }
                : undefined
            }
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition",
              tab === t.key
                ? "text-os-accent"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
        <span aria-hidden className="flex-1 border-b-2" />
      </nav>

      {/* One scroll region for whichever tab is open. `min-h-0` is what lets a
          flex child actually shrink below its content and scroll. */}
      <div className="flex min-h-0 flex-1 flex-col md:overflow-y-auto md:pr-1">
      {tab === "details" && <DetailsTab data={data} />}

      {tab === "sessions" && <SessionsTab data={data} />}

      {tab === "applications" && (
        <div className="flex flex-col gap-3">
          {applications.length === 0 ? (
            <p className="rounded-os-card bg-os-card px-6 py-5 text-sm italic text-os-grey">
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
                      className={cn(
                        "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                        appFilter === s
                          ? "bg-os-accent text-os-card"
                          : "bg-os-well text-os-grey hover:text-foreground",
                      )}
                    >
                      {s === "all" ? `All ${applications.length}` : `${s} ${appCounts[s] ?? 0}`}
                    </button>
                  ))}
                {(appCounts["Submitted"] ?? 0) > 0 && (
                  <Form
                    method="post"
                    className="ml-auto"
                    onSubmit={confirmSubmit(approveAllConfirm(appCounts["Submitted"] ?? 0))}
                  >
                    <input type="hidden" name="intent" value="approve-all-pending" />
                    <Button type="submit">
                      Approve all {appCounts["Submitted"]} pending
                    </Button>
                  </Form>
                )}
              </div>
              {(appCounts["Waitlisted"] ?? 0) > 0 &&
                (appFilter === "all" || appFilter === "Waitlisted") && (
                  <WaitlistOrder applications={applications} />
                )}
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
            <ManageSection
              title="Self check-in"
              description="Open check-in and project the QR. Students scan it to mark themselves present. You can still mark anyone by hand below."
              action={
                <Form method="post" className="shrink-0">
                  <input type="hidden" name="intent" value="set-session-check-in" />
                  <input type="hidden" name="sessionId" value={sessionCheckIn.sessionId} />
                  <input type="hidden" name="open" value={sessionCheckIn.open ? "false" : "true"} />
                  <Button type="submit" variant={sessionCheckIn.open ? "secondary" : "primary"}>
                    {sessionCheckIn.open ? "Close check-in" : "Open self check-in"}
                  </Button>
                </Form>
              }
            >
              {sessionCheckIn.open && sessionCheckIn.checkInQrSvg && sessionCheckIn.checkInUrl && (
                <div className="flex flex-wrap items-center gap-5">
                  <div
                    className="h-44 w-44 shrink-0 rounded-os-item bg-white p-3 [&_svg]:h-full [&_svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: sessionCheckIn.checkInQrSvg }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      Check-in is open for this session.
                    </p>
                    <p className="mt-1 text-sm text-os-grey">
                      Students scan the code (signed in) to mark themselves present. Marks appear in
                      the roster below.
                    </p>
                    <a
                      href={sessionCheckIn.checkInUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block break-all text-sm text-os-accent hover:underline"
                    >
                      {sessionCheckIn.checkInUrl}
                    </a>
                  </div>
                </div>
              )}
              {!sessionCheckIn.open && (
                <p className="text-sm text-os-grey">
                  Check-in is closed. Open it to show the QR code.
                </p>
              )}
            </ManageSection>
          )}
          <RosterMatrix
            sessions={attendanceMatrix.sessions.map((s) => ({
              id: s.id,
              sequence: s.sequence,
              datetime: s.datetime,
              endsAt: s.endsAt,
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

      {tab === "feedback" && <FeedbackTab data={data} />}
      </div>
    </div>
  );
}
