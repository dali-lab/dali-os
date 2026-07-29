import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.hub";
import { requireEnrollment } from "~/education/lib/access.server";
import { getHubData } from "~/education/lib/lms.server";
import { runDiscussionAction } from "~/education/lib/discussions.server";
import { CourseHub } from "~/education/components/CourseHub";
import { parseSessionCookie } from "~/lib/cookies";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.hub.offering.title ?? "Course"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, applicationId } = await requireEnrollment(
    request,
    params.offeringId!,
    "portal",
  );
  const hub = await getHubData({
    offeringId: params.offeringId!,
    userId: auth.user.sub,
    applicationId,
    isManager: false,
  });
  if (!hub) throw new Response("Not found", { status: 404 });
  return { hub, collabToken: parseSessionCookie(request) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { auth } = await requireEnrollment(request, params.offeringId!, "portal");
  return runDiscussionAction(await request.formData(), {
    offeringId: params.offeringId!,
    userId: auth.user.sub,
    isManager: false,
  });
}

export default function PortalCourseHub() {
  const { hub, collabToken } = useLoaderData<typeof loader>();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-4">
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
