import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.hub";
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
import { parseSessionCookie } from "~/lib/cookies";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.hub.offering.title ?? "Course"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, applicationId, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    "portal",
  );

  const roles = await getUserRoles(auth.user.sub, request);
  const redesign = await isFeatureEnabled("education-redesign", auth.user.sub, roles, request);

  const hub = await getHubData({
    offeringId: params.offeringId!,
    userId: auth.user.sub,
    applicationId,
    isManager: redesign ? isManager : false,
  });
  if (!hub) throw new Response("Not found", { status: 404 });

  // Instructor extras: only when redesign + manager
  const instructor =
    redesign && isManager
      ? await getInstructorHubExtras(params.offeringId!)
      : null;

  // Session roster for mark-by-hand, defaulting to the journey's current stop.
  const sessionIdParam = new URL(request.url).searchParams.get("session");
  const rosterSessionId =
    sessionIdParam ?? (instructor ? currentJourneySessionId(hub.sessions) : null);
  const rosterForSession =
    isManager && rosterSessionId
      ? await getSessionRoster(params.offeringId!, rosterSessionId)
      : null;

  return { hub, collabToken: parseSessionCookie(request), redesign, instructor, rosterForSession };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { auth, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    "portal",
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

export default function PortalCourseHub() {
  const { hub, collabToken, redesign, instructor, rosterForSession } = useLoaderData<typeof loader>();

  if (redesign) {
    return (
      <div className="w-full px-4 sm:px-6 py-8">
        <CourseHubV2
          data={hub}
          basePath={`/portal/education/${hub.offering.id}`}
          collabToken={collabToken}
          isMemberShell={false}
          instructor={instructor}
          rosterForSession={rosterForSession}
        />
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 py-8 flex flex-col gap-4">
      <header>
        <p className="text-xs text-muted-foreground">
          <Link to={`/portal/education/${hub.offering.id}`} className="hover:underline">
            ← Offering details
          </Link>
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-dark-blue">
          {hub.offering.title}
        </h1>
      </header>
      <CourseHub
        data={hub}
        basePath={`/portal/education/${hub.offering.id}`}
        collabToken={collabToken}
      />
    </div>
  );
}
