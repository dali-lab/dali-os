import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.$offeringId.hub";
import { requireEnrollment } from "~/education/lib/access.server";
import { getHubData } from "~/education/lib/lms.server";
import {
  runDiscussionAction,
  DISCUSSION_INTENTS,
} from "~/education/lib/discussions.server";
import { runManageAction } from "~/education/lib/manage-actions.server";
import {
  getInstructorHubExtras,
  currentJourneySessionId,
} from "~/education/lib/manage-hub.server";
import { getSessionRoster } from "~/education/lib/attendance.server";
import { CourseHub } from "~/education/components/CourseHub";
import { CourseHubV2 } from "~/education/components/v2/CourseHubV2";
import { buttonClasses } from "~/components/ui/Button";
import { parseSessionCookie } from "~/lib/cookies";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadEducationDriveScope } from "~/lib/drive-scopes.server";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.hub.offering.title ?? "Course"} · DALI OS` },
];

export const handle = {
  breadcrumbTrail: (
    data: { hub: { offering: { id: string; title: string } } } | undefined,
  ) => {
    if (!data) return null;
    const { id, title } = data.hub.offering;
    return [
      { label: "Education", to: "/education" },
      { label: title, to: `/education/${id}` },
      { label: "Course hub" },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, applicationId, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    "member",
  );
  const previewAsStudent =
    isManager && new URL(request.url).searchParams.get("as") === "student";
  const hub = await getHubData({
    offeringId: params.offeringId!,
    userId: auth.user.sub,
    applicationId,
    isManager: isManager && !previewAsStudent,
  });
  if (!hub) throw new Response("Not found", { status: 404 });
  recordRouteVisit(auth.user.sub, `/education/${hub.offering.id}/hub`, hub.offering.title, request);

  const roles = await getUserRoles(auth.user.sub, request);
  const redesign = await isFeatureEnabled("education-redesign", auth.user.sub, roles, request);

  // Instructor extras (editing mode): only when redesign + manager + not previewing
  const instructor =
    redesign && isManager && !previewAsStudent
      ? await getInstructorHubExtras(params.offeringId!)
      : null;

  // Session roster for mark-by-hand: ?session= when the instructor picked a
  // stop, defaulting to the journey's current stop (in-progress, else next
  // upcoming, else last) so the pane can mark attendance on first land.
  const sessionIdParam = new URL(request.url).searchParams.get("session");
  const rosterSessionId =
    sessionIdParam ?? (instructor ? currentJourneySessionId(hub.sessions) : null);
  const rosterForSession =
    isManager && !previewAsStudent && rosterSessionId
      ? await getSessionRoster(params.offeringId!, rosterSessionId)
      : null;

  // Drive embed for the Files tab (redesign only). Loaded so tab-switching is
  // instant; same cost profile as the project hub's equivalent.
  const offeringDriveScope = redesign
    ? await loadEducationDriveScope({
        userSub: auth.user.sub,
        offeringId: params.offeringId!,
        offeringTitle: hub.offering.title,
        request,
      })
    : null;

  return { hub, collabToken: parseSessionCookie(request), previewAsStudent, redesign, instructor, rosterForSession, offeringDriveScope };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { auth, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    "member",
  );
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (DISCUSSION_INTENTS.includes(intent)) {
    return runDiscussionAction(formData, {
      offeringId: params.offeringId!,
      userId: auth.user.sub,
      isManager,
    });
  }
  if (!isManager) return Response.json({ error: "Forbidden" }, { status: 403 });
  return runManageAction(formData, {
    offeringId: params.offeringId!,
    actorId: auth.user.sub,
  });
}

export default function MemberCourseHub() {
  const { hub, collabToken, previewAsStudent, redesign, instructor, rosterForSession, offeringDriveScope } = useLoaderData<typeof loader>();

  const previewPill = previewAsStudent ? (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-accent-teal/40 bg-card/95 px-4 py-2 shadow-brand-2 backdrop-blur">
        <span className="text-sm font-medium text-foreground">👁 Viewing as a student</span>
        <Link
          to={`/education/${hub.offering.id}/hub`}
          className={buttonClasses("secondary", "sm")}
        >
          Exit
        </Link>
      </div>
    </div>
  ) : null;

  if (redesign) {
    return (
      <>
        <CourseHubV2
          data={hub}
          basePath={`/education/${hub.offering.id}`}
          collabToken={collabToken}
          isMemberShell={true}
          instructor={instructor}
          rosterForSession={rosterForSession}
          previewAsStudent={previewAsStudent}
          offeringDriveScope={offeringDriveScope ?? undefined}
        />
        {previewPill}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {hub.offering.title}
          </h1>
        </div>
        {hub.isManager && (
          <div className="flex items-center gap-2">
            <Link
              to={`/education/${hub.offering.id}/hub?as=student`}
              className={buttonClasses("ghost", "sm")}
            >
              View as student
            </Link>
            <Link
              to={`/education/manage/${hub.offering.id}`}
              className={buttonClasses("secondary", "sm")}
            >
              Manage
            </Link>
          </div>
        )}
      </header>
      <CourseHub
        data={hub}
        basePath={`/education/${hub.offering.id}`}
        collabToken={collabToken}
      />
      {previewPill}
    </div>
  );
}
