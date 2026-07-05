import { useLoaderData } from "react-router";
import type { Route } from "./+types/education.enrolled.$id.discussions";
import { requireEnrollment } from "~/education/lib/auth";
import { listDiscussionThreads } from "~/education/lib/discussions-data";
import { DiscussionThread } from "~/education/components/DiscussionThread";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireEnrollment(request, params.id);

  const discussions = await listDiscussionThreads(params.id, user.sub);

  return {
    offeringId: params.id,
    viewerUserId: user.sub,
    discussions,
  };
}

export default function EnrolledDiscussions() {
  const { offeringId, viewerUserId, discussions } = useLoaderData<typeof loader>();
  return (
    <div>
      <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
        Discussion
      </h2>
      <DiscussionThread
        offeringId={offeringId}
        viewerUserId={viewerUserId}
        posts={discussions as any}
      />
    </div>
  );
}
