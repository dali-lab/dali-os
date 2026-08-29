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
  // Flat routes drop the opaque :offeringId, so the offering's own landing page
  // (/education/:id) can't appear from the segment walk — declare the trail so
  // the hub links back up to it (replacing the old inline "Offering details").
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
  // Canvas-style "Student View": a manager can render the hub as a student sees
  // it (no manage affordances, student-framed empty state) to sanity-check the
  // experience. Only a real manager can enter it — a student passing ?as has no
  // manager flag to drop.
  const previewAsStudent =
    isManager && new URL(request.url).searchParams.get("as") === "student";
  const hub = await getHubData({
    offeringId: params.offeringId!,
    userId: auth.user.sub,
    applicationId,
    isManager: isManager && !previewAsStudent,
  });
  if (!hub) throw new Response("Not found", { status: 404 });
  // After the enrollment gate — the hub the viewer can open lands in recents.
  recordRouteVisit(auth.user.sub, `/education/${hub.offering.id}/hub`, hub.offering.title, request);
  return { hub, collabToken: parseSessionCookie(request), previewAsStudent };
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
  const { hub, collabToken, previewAsStudent } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {hub.offering.title}
          </h1>
        </div>
        {/* Manager affordances only when NOT previewing — during a preview the
            page is rendered exactly as a student sees it (isManager=false), so
            the only added chrome is the floating exit pill below, which is
            fixed-position and doesn't shift the hub's layout. */}
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
      {previewAsStudent && (
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
      )}
    </div>
  );
}
