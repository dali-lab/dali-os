import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.$offeringId.hub";
import { requireEnrollment } from "~/education/lib/access.server";
import { getHubData } from "~/education/lib/lms.server";
import { runDiscussionAction } from "~/education/lib/discussions.server";
import { CourseHub } from "~/education/components/CourseHub";
import { buttonClasses } from "~/components/ui/Button";
import { parseSessionCookie } from "~/lib/cookies";
import { recordRouteVisit } from "~/lib/user-pages.server";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.hub.offering.title ?? "Course"} · DALI OS` },
];

export const handle = {
  breadcrumb: (data: { hub: { offering: { title: string } } } | undefined) =>
    data?.hub.offering.title ?? "Course hub",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, applicationId, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    "member",
  );
  const hub = await getHubData({
    offeringId: params.offeringId!,
    userId: auth.user.sub,
    applicationId,
    isManager,
  });
  if (!hub) throw new Response("Not found", { status: 404 });
  // After the enrollment gate — the hub the viewer can open lands in recents.
  recordRouteVisit(auth.user.sub, `/education/${hub.offering.id}/hub`, hub.offering.title);
  return { hub, collabToken: parseSessionCookie(request) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { auth, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    "member",
  );
  return runDiscussionAction(await request.formData(), {
    offeringId: params.offeringId!,
    userId: auth.user.sub,
    isManager,
  });
}

export default function MemberCourseHub() {
  const { hub, collabToken } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link to={`/education/${hub.offering.id}`} className="hover:underline">
              ← Offering details
            </Link>
          </p>
          <h1 className="mt-1 font-heading text-2xl font-bold text-foreground">
            {hub.offering.title}
          </h1>
        </div>
        {hub.isManager && (
          <Link
            to={`/education/manage/${hub.offering.id}`}
            className={buttonClasses("secondary", "sm")}
          >
            Manage
          </Link>
        )}
      </header>
      <CourseHub
        data={hub}
        basePath={`/education/${hub.offering.id}`}
        collabToken={collabToken}
      />
    </div>
  );
}
